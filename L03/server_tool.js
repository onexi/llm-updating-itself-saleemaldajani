import express from 'express';
import bodyParser from 'body-parser';
import { OpenAI } from 'openai';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Express server
const app = express();
app.use(bodyParser.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.resolve(process.cwd(), './public')));

// OpenAI API configuration
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

let state = {
  chatgpt: false,
  assistant_id: "",
  assistant_name: "",
  dir_path: "",
  news_path: "",
  thread_id: "",
  user_message: "",
  run_id: "",
  run_status: "",
  vector_store_id: "",
  tools: [],
  parameters: []
};

// Helper: Get the functions directory.
// Since we're already in L03, simply use the "functions" subfolder.
function getFunctionsDirectory() {
  return path.resolve(process.cwd(), 'functions');
}

// Helper: Dynamically load all functions from the functions directory
async function getFunctions() {
  const functionsDir = getFunctionsDirectory();
  if (!fs.existsSync(functionsDir)) {
    fs.mkdirSync(functionsDir, { recursive: true });
  }
  const files = fs.readdirSync(functionsDir);
  const openAIFunctions = {};

  for (const file of files) {
    if (file.endsWith(".js")) {
      const moduleName = file.slice(0, -3);
      const modulePath = path.resolve(functionsDir, file);
      const moduleUrl = pathToFileURL(modulePath).href;
      const { details, execute } = await import(moduleUrl);
      openAIFunctions[moduleName] = { details, execute };
    }
  }
  return openAIFunctions;
}

// Route: Process GPT-generated tool code and add it as a new tool
app.post('/api/add-tool', async (req, res) => {
  try {
    let { gpt_tool_code } = req.body;
    if (!gpt_tool_code) {
      return res.status(400).json({ error: "No tool code provided." });
    }
    // Remove markdown triple backticks and optional language tag
    gpt_tool_code = gpt_tool_code.replace(/```[a-z]*\s*/gi, '').replace(/```\s*/g, '');
    
    // Extract the tool's function name from the code using a regex on the details object.
    const toolNameMatch = gpt_tool_code.match(/name:\s*['"]([^'"]+)['"]/);
    if (!toolNameMatch) {
      return res.status(400).json({ error: "Tool name not found in the provided tool code." });
    }
    const toolName = toolNameMatch[1];
    
    // Save the tool file in the functions directory using the tool's function name
    const functionsDir = getFunctionsDirectory();
    if (!fs.existsSync(functionsDir)) {
      fs.mkdirSync(functionsDir, { recursive: true });
    }
    const filePath = path.resolve(functionsDir, `${toolName}.js`);
    fs.writeFileSync(filePath, gpt_tool_code, 'utf8');
    
    // Dynamically import the module to retrieve its details
    const moduleUrl = pathToFileURL(filePath).href;
    const toolModule = await import(moduleUrl);
    
    console.log(`Tool '${toolName}' added successfully. Details:`, toolModule.details);
    res.json({ message: `Tool '${toolName}' added successfully to ${filePath}.`, details: toolModule.details });
  } catch (error) {
    console.error("Error adding tool:", error);
    res.status(500).json({ error: "Failed to add tool.", details: error.message });
  }
});

// Route: Execute a specific function/tool
app.post('/api/execute-function', async (req, res) => {
  const { functionName, parameters } = req.body;
  const functions = await getFunctions();

  if (!functions[functionName]) {
    return res.status(404).json({ error: 'Function not found' });
  }

  try {
    const result = await functions[functionName].execute(...Object.values(parameters));
    console.log(`result: ${JSON.stringify(result)}`);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Function execution failed', details: err.message });
  }
});

// Updated route: Interact with OpenAI API using available tools if any.
// If no function call is detected, check if the GPT output contains a tool schema,
// then automatically process it to add a new tool.
app.post('/api/openai-call', async (req, res) => {
  const { user_message } = req.body;
  const functions = await getFunctions();
  const availableFunctions = Object.values(functions).map(fn => fn.details);
  console.log(`availableFunctions: ${JSON.stringify(availableFunctions)}`);
  
  let messages = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: user_message }
  ];
  
  try {
    let response;
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
    
    const toolCall = response.choices[0].message.tool_calls && response.choices[0].message.tool_calls[0];
    if (toolCall) {
      const functionName = toolCall.function.name;
      const parameters = JSON.parse(toolCall.function.arguments);
      const result = await functions[functionName].execute(...Object.values(parameters));
      const function_call_result_message = {
        role: "tool",
        content: JSON.stringify({ result }),
        tool_call_id: toolCall.id
      };
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
      // Check if the GPT output appears to be a tool schema (code with tool definition)
      const gptOutput = response.choices[0].message.content;
      if (gptOutput.includes("export { execute, details }") && gptOutput.includes("const execute")) {
        // Process the GPT output as tool code.
        try {
          let processedCode = gptOutput.replace(/```[a-z]*\s*/gi, '').replace(/```\s*/g, '');
          // Remove any text before the code starts (i.e. before "const execute")
          const codeStart = processedCode.indexOf("const execute");
          if (codeStart !== -1) {
            processedCode = processedCode.slice(codeStart);
          }
          // Trim any extra text after the export statement
          const exportMarker = "export { execute, details }";
          const exportIndex = processedCode.lastIndexOf(exportMarker);
          if (exportIndex !== -1) {
            processedCode = processedCode.slice(0, exportIndex + exportMarker.length);
          }
          
          const toolNameMatch = processedCode.match(/name:\s*['"]([^'"]+)['"]/);
          if (!toolNameMatch) {
            return res.status(400).json({ error: "Tool name not found in GPT output." });
          }
          const toolName = toolNameMatch[1];
          const functionsDir = getFunctionsDirectory();
          if (!fs.existsSync(functionsDir)) {
            fs.mkdirSync(functionsDir, { recursive: true });
          }
          const filePath = path.resolve(functionsDir, `${toolName}.js`);
          fs.writeFileSync(filePath, processedCode, 'utf8');
          
          const moduleUrl = pathToFileURL(filePath).href;
          const toolModule = await import(moduleUrl);
          
          console.log(`Tool '${toolName}' added successfully from GPT output. Details:`, toolModule.details);
          return res.json({ message: `Tool '${toolName}' added successfully to ${filePath}.`, details: toolModule.details });
        } catch (error) {
          console.error("Error processing GPT output as tool:", error);
          return res.status(500).json({ error: "Failed to process GPT output as tool.", details: error.message });
        }
      }
      
      console.log("No function call detected. GPT output:", gptOutput);
      return res.json({ message: 'No function call detected. GPT output: ' + gptOutput });
    }
  } catch (error) {
    return res.status(500).json({ error: 'OpenAI API failed', details: error.message });
  }
});

// Route: Update prompt state
app.post('/api/prompt', async (req, res) => {
  state = req.body;
  try {
    res.status(200).json({ message: `Got prompt: ${state.user_message}`, state: state });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'User Message Failed', state: state });
  }
});

// Default route to serve index.html for any undefined routes
app.get('*', (req, res) => {
  res.sendFile(path.resolve(process.cwd(), './public/index.html'));
});

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
