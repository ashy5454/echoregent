// test_reduction.js
// Run: node test_reduction.js

async function runTest() {
  const adminUrl = 'http://127.0.0.1:8787/admin/keys';
  const compressUrl = 'http://127.0.0.1:8787/compress';
  
  console.log("--- Step 1: Generating a Valid API Key via Admin API ---");
  let apiKey = '';
  
  try {
    const keyRes = await fetch(adminUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': process.env.CTS_ADMIN_SECRET || ''
      },
      body: JSON.stringify({
        name: 'test_user',
        ownerEmail: 'test@example.com'
      })
    });

    if (!keyRes.ok) {
      throw new Error(`Admin key creation failed with status: ${keyRes.status}`);
    }

    const keyData = await keyRes.json();
    apiKey = keyData.key;
    console.log(`Generated Key: ${apiKey}`);
  } catch (err) {
    console.error("Failed to generate test key:", err.message);
    console.log("Make sure your local CTS server is running! Run 'npm run api' in the cts folder.");
    return;
  }

  // Create a massive stack trace (50 repeating lines)
  const repeatingStackTrace = Array(50)
    .fill("  at Object.invokeGuardedCallbackProd (react-dom.production.min.js:1024:12)")
    .join("\n");
    
  const longLog = `Error: Connection Timeout\n${repeatingStackTrace}\n  at throwError (app.js:42:1)`;

  // Create a 6-turn conversation history to trigger context compression (>4 turns required)
  const payload = {
    message: "Can you help me fix it?",
    history: [
      { role: "user", content: "Hi Claude, I'm setting up a Next.js app with Stripe." },
      { role: "assistant", content: "Sure! Webhooks or checkout sessions?" },
      { role: "user", content: "Webhooks. When I start it up, it crashes with this log:" },
      { role: "assistant", content: "Please share the log." },
      { role: "user", content: longLog },
      { role: "assistant", content: "I see. It looks like a connection timeout during the API initialization. Let's inspect the network configurations." }
    ]
  };

  console.log("\n--- Step 2: Sending Compression Request to Local CTS ---");
  
  const totalOriginalText = payload.history.map(h => h.content).join("\n") + "\n" + payload.message;
  console.log(`Original History Length: ${totalOriginalText.length} characters (approx. ${Math.ceil(totalOriginalText.length / 4)} tokens)`);
  
  try {
    const response = await fetch(compressUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Server returned ${response.status}: ${errText}`);
    }

    const result = await response.json();
    const compressedText = result.compressedHistory.map(h => `[${h.role}]: ${h.content}`).join("\n");
    
    console.log("\n--- Step 3: Response Received ---");
    console.log("Compressed History Context:");
    console.log("-----------------------------------------");
    console.log(compressedText);
    console.log("-----------------------------------------");
    console.log(`Compressed Length: ${compressedText.length} characters (approx. ${Math.ceil(compressedText.length / 4)} tokens)`);
    console.log(`💡 Tokens Saved: ${result.tokensSaved}`);
    console.log(`💡 Intent Classified: ${result.intent}`);
    console.log(`💡 Domain Routing: ${result.domain}`);
    console.log("\n📈 Success! Open your local dashboard at http://localhost:8787/admin-ui to see this call logged!");
  } catch (err) {
    console.error("Compression execution failed:", err.message);
  }
}

runTest();
