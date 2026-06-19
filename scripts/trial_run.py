import re

def count_tokens(text):
    # A rough approximation: 1 token ~= 4 characters or 1 word
    return len(text.split())

def smart_scrape(text):
    """
    Strategy 1: The Smart Scraper
    Removes the middle of massive stack traces and minified data.
    """
    original_len = count_tokens(text)
    
    # 1. Strip middle of stack traces (keep top 3 lines and bottom 3 lines)
    # Looking for blocks of lines starting with "at " or "Traceback"
    lines = text.split('\n')
    cleaned_lines = []
    in_stack_trace = False
    stack_trace_buffer = []

    for line in lines:
        if line.strip().startswith('at ') or 'Traceback' in line or '.js:' in line or '.py:' in line:
            in_stack_trace = True
            stack_trace_buffer.append(line)
        else:
            if in_stack_trace:
                if len(stack_trace_buffer) > 6:
                    cleaned_lines.extend(stack_trace_buffer[:3])
                    cleaned_lines.append("... [STACK TRACE COMPRESSED by CTS] ...")
                    cleaned_lines.extend(stack_trace_buffer[-3:])
                else:
                    cleaned_lines.extend(stack_trace_buffer)
                stack_trace_buffer = []
                in_stack_trace = False
            cleaned_lines.append(line)
            
    if in_stack_trace:
        if len(stack_trace_buffer) > 6:
            cleaned_lines.extend(stack_trace_buffer[:3])
            cleaned_lines.append("... [STACK TRACE COMPRESSED by CTS] ...")
            cleaned_lines.extend(stack_trace_buffer[-3:])
        else:
            cleaned_lines.extend(stack_trace_buffer)

    scraped_text = '\n'.join(cleaned_lines)
    
    # 2. Strip Base64 strings (fake example regex)
    scraped_text = re.sub(r'data:image\/[a-zA-Z]*;base64,[^\s"\'>]+', '[BASE64_IMAGE_REMOVED]', scraped_text)
    
    # 3. Strip massive JSON payloads (naive approach for test)
    # If a line is longer than 500 characters, it's likely minified JSON/Code
    final_lines = []
    for line in scraped_text.split('\n'):
        if len(line) > 500:
            final_lines.append(line[:100] + " ... [LONG LINE TRUNCATED by CTS] ... " + line[-50:])
        else:
            final_lines.append(line)

    return '\n'.join(final_lines)

def sliding_window_t5_simulate(text):
    """
    Strategy 2: Sliding Window for T5
    Simulates splitting into 512-token chunks and summarizing each.
    """
    words = text.split()
    chunks = []
    chunk_size = 400 # 400 words is a safe limit for 512 tokens
    
    for i in range(0, len(words), chunk_size):
        chunk = " ".join(words[i:i+chunk_size])
        chunks.append(chunk)
        
    # Simulate T5 returning a 30-word summary for each chunk
    simulated_summary = []
    for i, chunk in enumerate(chunks):
        simulated_summary.append(f"[T5 Summary of Chunk {i+1}]: The user encountered an error related to {chunk[:50]}...")
        
    return "\n".join(simulated_summary)


# === TRIAL RUN ===
if __name__ == "__main__":
    print("--- CTS Coding Optimization Trial Run ---")
    
    # Generate a massive fake terminal dump
    fake_log = "User: Claude, my React app is failing to build.\n"
    fake_log += "Here is the error log:\n\n"
    
    # Add a massive stack trace (100 lines)
    fake_log += "Traceback (most recent call last):\n"
    for i in range(100):
        fake_log += f"  at Object.invokeGuardedCallbackProd (react-dom.production.min.js:{1000+i}:12)\n"
    fake_log += "  at throwError (app.js:42:1)\n\n"
    
    # Add a massive minified string
    fake_log += "And here is the payload that crashed it:\n"
    fake_log += 'const payload = {"data": "' + ('A' * 2000) + '", "status": "failed"};\n'
    
    print(f"Original Text Size: {count_tokens(fake_log)} tokens")
    
    # 1. Run Smart Scrape
    scraped = smart_scrape(fake_log)
    scraped_tokens = count_tokens(scraped)
    print(f"After Smart Scraper: {scraped_tokens} tokens (Reduced by {100 - (scraped_tokens/count_tokens(fake_log)*100):.1f}%)")
    
    # 2. Run T5 Sliding Window Simulator
    t5_result = sliding_window_t5_simulate(scraped)
    t5_tokens = count_tokens(t5_result)
    print(f"After T5 Compression: {t5_tokens} tokens")
    
    print("\n--- Final Output Sent to Claude ---")
    print(t5_result)
