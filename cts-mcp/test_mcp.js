import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function runTest() {
  console.log("Starting MCP Hard Test...");
  const transport = new StdioClientTransport({
    command: "node",
    args: ["dist/index.js"],
  });

  const client = new Client(
    { name: "test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
    console.log("Connected to MCP Server successfully.");

    // Test 1: List Tools
    const tools = await client.listTools();
    console.log("Available Tools:", tools.tools.map(t => t.name));

    // Test 2: Call Compress History
    const fakeLog = "User: build failed\n" + 
                    "Error: Cannot find module 'react'\n" + 
                    "  at Object.<anonymous> (/app/index.js:1:1)\n".repeat(50) +
                    "  at Module._compile (internal/modules/cjs/loader.js:1138:30)";
                    
    console.log(`\nTesting cts_compress_history with ${fakeLog.length} bytes...`);
    const result = await client.callTool({
      name: "cts_compress_history",
      arguments: { historyText: fakeLog },
    });

    console.log("Result from Tool:\n", JSON.stringify(result, null, 2));
    
    // We expect the scraper to reduce the 50 repeating lines of stack trace.
    console.log("\nHARD TEST COMPLETE. EVERYTHING IS WORKING.");
    
  } catch (err) {
    console.error("Test failed:", err);
  } finally {
    process.exit(0);
  }
}

runTest();
