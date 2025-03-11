#!/usr/bin/env node

import axios from 'axios';
import type { AxiosError } from 'axios';
import { loadEnv } from './config/dotenv.js';
import { 
  Client, 
  GatewayIntentBits, 
  REST, 
  Routes, 
  SlashCommandBuilder
} from 'discord.js';
import type {
  SlashCommandStringOption,
  SlashCommandIntegerOption,
  SlashCommandNumberOption,
  SlashCommandBooleanOption,
  ChatInputCommandInteraction,
  RESTPostAPIApplicationCommandsJSONBody
} from 'discord.js';

// Load environment variables
loadEnv();

// Get SLOP server URL from arguments or environment
const args = process.argv.slice(2);
let slopUrl = args[0] || process.env.SLOP_URL || 'http://localhost:4000';

// Ensure URL has proper format
if (!slopUrl.startsWith('http')) {
  slopUrl = `http://${slopUrl}`;
}

// Create axios instance for SLOP API calls
const slopApi = axios.create({
  baseURL: slopUrl,
  timeout: 30000
});

// Define types for SLOP responses and tools
interface SlopErrorResponse {
  error?: string;
  status?: number;
}

interface SlopToolResponse {
  result: unknown;
}

interface SlopTool {
  id: string;
  description?: string;
  parameters?: Record<string, SlopToolParameter>;
}

interface SlopToolParameter {
  type: string;
  description?: string;
  required?: boolean;
}

/**
 * Formats SLOP errors into readable messages
 */
function handleSlopError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<SlopErrorResponse>;
    const message = axiosError.response?.data?.error || axiosError.message || 'Unknown error';
    const status = axiosError.response?.status || 500;
    return `SLOP server error (${status}): ${message}`;
  }
  return `Unknown error: ${String(error)}`;
}

/**
 * Maps SLOP parameter types to Discord option types
 */
function mapSlopTypeToDiscordType(slopType: string): 'String' | 'Number' | 'Integer' | 'Boolean' {
  switch (slopType.toLowerCase()) {
    case 'string':
      return 'String';
    case 'number':
    case 'float':
    case 'double':
      return 'Number';
    case 'integer':
    case 'int':
      return 'Integer';
    case 'boolean':
    case 'bool':
      return 'Boolean';
    default:
      return 'String'; 
  }
}

/**
 * Extracts parameter information from tool description
 * For tools that don't provide a parameters field but include format in description
 */
function extractParametersFromDescription(description: string): Record<string, SlopToolParameter> | undefined {
  // Look for JSON format in the description
  const formatMatch = description.match(/format\s+(\{.*?\})/);
  if (!formatMatch) return undefined;
  
  try {
    // Try to parse the format as a JSON object
    const formatStr = formatMatch[1].replace(/\\"/g, '"');
    // Extract parameter names from the format
    const paramRegex = /"([^"]+)":/g;
    const params: Record<string, SlopToolParameter> = {};
    let match;
    
    while ((match = paramRegex.exec(formatStr)) !== null) {
      const paramName = match[1];
      params[paramName] = {
        type: 'string',
        description: `${paramName} parameter`,
        required: true
      };
    }
    
    return Object.keys(params).length > 0 ? params : undefined;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  } catch (error) {
    console.warn(`Failed to extract parameters from description: ${description}`);
    return undefined;
  }
}

/**
 * Fetches SLOP tools and converts them to Discord slash commands
 */
async function fetchSlopToolsAndCreateCommands(): Promise<RESTPostAPIApplicationCommandsJSONBody[]> {
  try {
    // Fetch SLOP tools
    const toolsResponse = await slopApi.get('/tools');
    const slopTools = toolsResponse.data.tools as SlopTool[] || [];
    
    console.log(`Found ${slopTools.length} SLOP tools to register as Discord commands`);
    
    if (slopTools.length === 0) {
      console.warn('No SLOP tools found. Make sure your SLOP server is running and has tools available.');
      return [];
    }
    
    // Convert SLOP tools to Discord commands
    return slopTools.map(tool => {
      const command = new SlashCommandBuilder()
        .setName(tool.id.toLowerCase().replace(/[^a-z0-9_-]/g, '_').substring(0, 32))
        .setDescription(tool.description || `Execute the ${tool.id} tool`);
      
      // Try to get parameters from the tool definition
      let parameters = tool.parameters;
      
      // If no parameters are provided, try to extract them from the description
      if (!parameters && tool.description) {
        parameters = extractParametersFromDescription(tool.description);
        if (parameters) {
          console.log(`Extracted parameters for ${tool.id} from description:`, parameters);
        }
      }
      
      // Add options if the tool has parameters
      if (parameters) {
        Object.entries(parameters).forEach(([paramName, paramDetails]) => {
          const optionName = paramName.toLowerCase().replace(/[^a-z0-9_-]/g, '_').substring(0, 32);
          const optionDescription = paramDetails.description || `Parameter: ${paramName}`;
          const required = paramDetails.required || false;
          const type = mapSlopTypeToDiscordType(paramDetails.type);
          
          switch (type) {
            case 'String':
              command.addStringOption((option: SlashCommandStringOption) => 
                option.setName(optionName)
                     .setDescription(optionDescription)
                     .setRequired(required)
              );
              break;
            case 'Integer':
              command.addIntegerOption((option: SlashCommandIntegerOption) => 
                option.setName(optionName)
                     .setDescription(optionDescription)
                     .setRequired(required)
              );
              break;
            case 'Number':
              command.addNumberOption((option: SlashCommandNumberOption) => 
                option.setName(optionName)
                     .setDescription(optionDescription)
                     .setRequired(required)
              );
              break;
            case 'Boolean':
              command.addBooleanOption((option: SlashCommandBooleanOption) => 
                option.setName(optionName)
                     .setDescription(optionDescription)
                     .setRequired(required)
              );
              break;
          }
        });
      }
      
      return command.toJSON();
    });
  } catch (error) {
    console.error(`Failed to fetch SLOP tools: ${handleSlopError(error)}`);
    throw error;
  }
}

/**
 * Handles a Discord command interaction by calling the corresponding SLOP tool
 */
async function handleCommandInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
  const { commandName, options } = interaction;
  
  try {
    // Defer reply to prevent timeout
    await interaction.deferReply();
    
    console.log(`Received command: ${commandName}`);
    
    // Convert Discord command options to SLOP parameters
    const params: Record<string, string | number | boolean> = {};
    options.data.forEach(option => {
      if (option.value !== undefined) {
        params[option.name] = option.value;
      }
    });
    
    console.log(`Calling SLOP tool ${commandName} with params:`, params);
    
    // Call the corresponding SLOP tool endpoint
    // For SLOP tools that expect a JSON object in the request body
    const response = await slopApi.post<SlopToolResponse>(
      `/tools/${commandName}`, 
      params, 
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Convert SLOP response to Discord format
    const result = typeof response.data.result === 'object' 
          ? JSON.stringify(response.data.result, null, 2)
          : String(response.data.result);
    
    // Send the result back to Discord
    await interaction.editReply({
      content: result.length > 2000 ? result.substring(0, 1997) + '...' : result
    });
    
  } catch (error) {
    const errorMessage = handleSlopError(error);
    console.error(`Error handling command ${commandName}:`, errorMessage);
    
    // Send error message back to Discord
    if (interaction.deferred) {
      await interaction.editReply({ content: `Error: ${errorMessage}` });
    } else {
      await interaction.reply({ content: `Error: ${errorMessage}`, ephemeral: true });
    }
  }
}

/**
 * Main function to start the Discord bot
 */
async function startBot(): Promise<void> {
  try {
    const token = process.env.DISCORD_TOKEN;
    const appId = process.env.DISCORD_APP_ID;
    
    if (!token) {
      throw new Error('DISCORD_TOKEN environment variable is required');
    }
    
    if (!appId) {
      throw new Error('DISCORD_APP_ID environment variable is required');
    }
    
    // 1. Fetch SLOP tools and create Discord commands
    console.log('Fetching SLOP tools and creating Discord commands...');
    const commands = await fetchSlopToolsAndCreateCommands();
    
    // 2. Register commands with Discord API
    console.log(`Registering ${commands.length} commands with Discord API...`);
    const rest = new REST({ version: '10' }).setToken(token);
    
    await rest.put(
      Routes.applicationCommands(appId),
      { body: commands }
    );
    
    console.log('Successfully registered Discord commands');
    
    // 3. Initialize Discord client
    const client = new Client({ 
      intents: [GatewayIntentBits.Guilds] 
    });
    
    // 4. Set up event handlers
    client.on('interactionCreate', async interaction => {
      if (interaction.isChatInputCommand()) {
        await handleCommandInteraction(interaction);
      }
    });
    
    // 5. Login to Discord
    await client.login(token);
    console.log(`Discord bot is online and connected to SLOP server at ${slopUrl}`);
    
  } catch (error) {
    console.error('Failed to start bot:', error);
    process.exit(1);
  }
}

// Start the bot
startBot().catch(error => {
  console.error('Failed to start bot:', error);
  process.exit(1);
});
