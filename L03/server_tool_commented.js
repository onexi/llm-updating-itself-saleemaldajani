// Import required modules
import express from 'express';                        // Express framework for handling HTTP requests
import bodyParser from 'body-parser';                 // Middleware to parse incoming request bodies
import { OpenAI } from 'openai';                      // OpenAI API client for interacting with GPT
import path from 'path';                              // Node.js module to work with file and directory paths
import { fileURLToPath, pathToFileURL } from 'url';    // Utilities to handle URL and file paths for ES modules
import fs from 'fs';                                  // Node.js file system module to read/write files
import dotenv from 'dotenv';                          // Loads environment variables from a .env file

// Load environment variables from .env file into process.env
dotenv.config();

// Initialize the Express server application
const app = express();
// Use bodyParser middleware to parse JSON request bodies
app.use(bodyParser.json());

// Determine the current file's name and directory using ES module utilities
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files from the "public" directory relative to the current working directory
app.use(express.static(path.resolve(process.cwd(), './public')));

// Initialize the OpenAI API client with the API key from environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Define a state object to maintain various properties for the server
let state = {
  chatgpt: false,         // Flag to indicate if ChatGPT is active
  assistant_id: "",       // ID of the assistant (if applicable)
  assistant_name: "",     // Name of the assistant
  dir_path: "",           // Directory path (if used)
  news_path: "",          // Path to news (if applicable)
  thread_id: "",          // Thread identifier for conversation context
  user_message: "",       // Latest message from the user
  run_id: "",             // Identifier for a run session
  run_status: "",         // Status of the current run
  vector_store_id: "",    // ID for a vector store (if used)
  tools: [],              // List of available tools
  parameters: []          // Parameters for tools or API calls
};

// Helper function: Get the functions directory.
// Since we're already inside the L03 directory, we simply use the "functions" subfolder.
function getFunctionsDirectory() {
  // process.cwd() returns the current working directory (which should be L03)
  return path.resolve(process.cwd(), 'functions');
}

// Helper function: Dynamically load all functions (tool modules) from the functions directory.
async function getFunctions() {
  const functionsDir = getFunctionsDirectory();
  // Create the functions directory if it does not exist
  if (!fs.existsSync(functionsDir)) {
    fs.mkdirSync(functionsDir, { recursive: true });
  }
  // Read all files in the functions directory
  const files = fs.readdirSync(functionsDir);
  const openAIFunctions = {};

  // Loop over each file and import it if it is a JavaScript file
  for (const file of files) {
    if (file.endsWith(".js")) {
      const moduleName = file.slice(0, -3); // Remove the .js extension to get the module name
      const modulePath = path.resolve(functionsDir, file);
      const moduleUrl = pathToFileURL(modulePath).href;
      // Dynamically import the module and extract its exported 'details' and 'execute' function
      const { details, execute } = await import(moduleUrl);
      openAIFunctions[moduleName] = { details, execute };
    }
  }
  return openAIFunctions;
}

// Route: Process GPT-generated tool code and add it as a new tool.
// This endpoint expects a POST request with a property 'gpt_tool_code' containing the tool code.
app.post('/api/add-tool', async (req, res) => {
  try {
    // Destructure the gpt_tool_code from the request body
    let { gpt_tool_code } = req.body;
    if (!gpt_tool_code) {
      // If no tool code is provided, return a 400 error
      return res.status(400).json({ error: "No tool code provided." });
    }
    // Remove markdown formatting (triple backticks and optional language tags like "javascript")
    gpt_tool_code = gpt_tool_code.replace(/```[a-z]*\s*/gi, '').replace(/```\s*/g, '');
    
    // Extract the tool's function name from the tool code using a regular expression.
    // It looks for the "name" property in the details object.
    const toolNameMatch = gpt_tool_code.match(/name:\s*['"]([^'"]+)['"]/);
    if (!toolNameMatch) {
      return res.status(400).json({ error: "Tool name not found in the provided tool code." });
    }
    const toolName = toolNameMatch[1];
    
    // Get the directory where tool modules are stored and ensure it exists.
    const functionsDir = getFunctionsDirectory();
    if (!fs.existsSync(functionsDir)) {
      fs.mkdirSync(functionsDir, { recursive: true });
    }
    // Create a file path for the new tool using its name (e.g., "subtractNumbers.js")
    const filePath = path.resolve(functionsDir, `${toolName}.js`);
    // Write the cleaned tool code to the file
    fs.writeFileSync(filePath, gpt_tool_code, 'utf8');
    
    // Dynamically import the newly saved tool module to verify its exports (details and execute)
    const moduleUrl = pathToFileURL(filePath).href;
    const toolModule = await import(moduleUrl);
    
    // Log and send a success response with the tool details
    console.log(`Tool '${toolName}' added successfully. Details:`, toolModule.details);
    res.json({ message: `Tool '${toolName}' added successfully to ${filePath}.`, details: toolModule.details });
  } catch (error) {
    // Log error details and send a 500 response if something goes wrong
    console.error("Error adding tool:", error);
    res.status(500).json({ error: "Failed to add tool.", details: error.message });
  }
});

// Route: Execute a specific function/tool.
// This endpoint expects a POST request with 'functionName' and 'parameters' in the body.
app.post('/api/execute-function', async (req, res) => {
  const { functionName, parameters } = req.body;
  // Load all available functions from the functions directory
  const functions = await getFunctions();

  // Check if the requested function exists; if not, return a 404 error
  if (!functions[functionName]) {
    return res.status(404).json({ error: 'Function not found' });
  }

  try {
    // Execute the tool function with the provided parameters.
    // Object.values(parameters) converts the parameters object into an array of values.
    const result = await functions[functionName].execute(...Object.values(parameters));
    console.log(`result: ${JSON.stringify(result)}`);
    res.json(result);
  } catch (err) {
    // Send a 500 response if execution fails
    res.status(500).json({ error: 'Function execution failed', details: err.message });
  }
});

// Updated Route: Interact with the OpenAI API using available tools.
// This endpoint sends a prompt to OpenAI along with any available tool definitions.
// If no function call is detected in the response, it checks if the GPT output contains a valid tool schema.
// If a tool schema is found, it processes and adds the new tool automatically.
app.post('/api/openai-call', async (req, res) => {
  const { user_message } = req.body;
  // Load all available functions from the functions directory
  const functions = await getFunctions();
  // Extract the details of each available tool for sending to the OpenAI API
  const availableFunctions = Object.values(functions).map(fn => fn.details);
  console.log(`availableFunctions: ${JSON.stringify(availableFunctions)}`);
  
  // Prepare the message history for the OpenAI API call
  let messages = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: user_message }
  ];
  
  try {
    let response;
    // If there are available tools, include them in the OpenAI API call; otherwise, call without tools
    if (availableFunctions.length > 0) {
      response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: messages,
        tools: availableFunctions
      });
    } else {
      response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: messages
      });
    }
    
    // Check if the response from OpenAI includes a tool call (i.e., a request to execute a function)
    const toolCall = response.choices[0].message.tool_calls && response.choices[0].message.tool_calls[0];
    if (toolCall) {
      // If a tool call is detected, extract the function name and parameters from the response
      const functionName = toolCall.function.name;
      const parameters = JSON.parse(toolCall.function.arguments);
      // Execute the requested function with the provided parameters
      const result = await functions[functionName].execute(...Object.values(parameters));
      // Construct a tool call result message to send back
      const function_call_result_message = {
        role: "tool",
        content: JSON.stringify({ result }),
        tool_call_id: toolCall.id
      };
      // Append the messages to the conversation history and send back to OpenAI for a final response
      messages.push(response.choices[0].message);
      messages.push(function_call_result_message);
      const final_response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: messages
      });
      let output = final_response.choices[0].message.content;
      return res.json({ message: output, state: state });
    } else {
      // No function call detected.
      // Check if the GPT output appears to be a tool schema (i.e., valid tool code with an export statement)
      const gptOutput = response.choices[0].message.content;
      if (gptOutput.includes("export { execute, details }") && gptOutput.includes("const execute")) {
        // Process the GPT output as tool code.
        try {
          // Remove markdown formatting from the GPT output
          let processedCode = gptOutput.replace(/```[a-z]*\s*/gi, '').replace(/```\s*/g, '');
          // Remove any text before the code starts (e.g., before "const execute")
          const codeStart = processedCode.indexOf("const execute");
          if (codeStart !== -1) {
            processedCode = processedCode.slice(codeStart);
          }
          // Trim any extra text after the export statement to ensure only valid code is kept
          const exportMarker = "export { execute, details }";
          const exportIndex = processedCode.lastIndexOf(exportMarker);
          if (exportIndex !== -1) {
            processedCode = processedCode.slice(0, exportIndex + exportMarker.length);
          }
          
          // Extract the tool's function name from the processed code
          const toolNameMatch = processedCode.match(/name:\s*['"]([^'"]+)['"]/);
          if (!toolNameMatch) {
            return res.status(400).json({ error: "Tool name not found in GPT output." });
          }
          const toolName = toolNameMatch[1];
          // Get the functions directory and ensure it exists
          const functionsDir = getFunctionsDirectory();
          if (!fs.existsSync(functionsDir)) {
            fs.mkdirSync(functionsDir, { recursive: true });
          }
          // Define the file path for the new tool using its name
          const filePath = path.resolve(functionsDir, `${toolName}.js`);
          // Write the processed code to the file
          fs.writeFileSync(filePath, processedCode, 'utf8');
          
          // Dynamically import the newly created tool module to retrieve its details
          const moduleUrl = pathToFileURL(filePath).href;
          const toolModule = await import(moduleUrl);
          
          console.log(`Tool '${toolName}' added successfully from GPT output. Details:`, toolModule.details);
          return res.json({ message: `Tool '${toolName}' added successfully to ${filePath}.`, details: toolModule.details });
        } catch (error) {
          // Log and return any errors encountered during processing of GPT output
          console.error("Error processing GPT output as tool:", error);
          return res.status(500).json({ error: "Failed to process GPT output as tool.", details: error.message });
        }
      }
      
      // If no function call is detected and the output doesn't contain tool code, log the output.
      console.log("No function call detected. GPT output:", gptOutput);
      return res.json({ message: 'No function call detected. GPT output: ' + gptOutput });
    }
  } catch (error) {
    // Return an error response if the OpenAI API call fails
    return res.status(500).json({ error: 'OpenAI API failed', details: error.message });
  }
});

// Route: Update prompt state
// This endpoint updates the server's internal state with the latest prompt information.
app.post('/api/prompt', async (req, res) => {
  state = req.body;
  try {
    res.status(200).json({ message: `Got prompt: ${state.user_message}`, state: state });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'User Message Failed', state: state });
  }
});

// Default route: Serve index.html for any undefined routes
// This ensures that any request not handled by the API routes returns the main HTML file.
app.get('*', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), './public/index.html'));
});

// Start the server on port 3000 and log the URL where the server is running.
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
