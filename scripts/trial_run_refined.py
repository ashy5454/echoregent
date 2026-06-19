import re

def count_tokens(text):
    return len(text.split())

def smart_scrape(text):
    lines = text.split('\n')
    
    # 1. Multi-line Deduper (Find repeating blocks of lines)
    # This detects if a block of 1 to 5 lines repeats consecutively.
    deduped_lines = []
    i = 0
    while i < len(lines):
        match_found = False
        # Try to find repeating blocks of size 1 to 5
        for block_size in range(1, 6):
            if i + block_size <= len(lines):
                block = lines[i:i+block_size]
                
                # Check how many times this block repeats consecutively
                repeat_count = 0
                j = i + block_size
                while j + block_size <= len(lines) and lines[j:j+block_size] == block:
                    # Ignore empty line repeating
                    if all(not line.strip() for line in block):
                        break
                    repeat_count += 1
                    j += block_size
                
                # If we found a block that repeats more than 2 times
                if repeat_count > 2:
                    deduped_lines.extend(block) # Keep the first instance (Preserves context!)
                    deduped_lines.append(f"... [{repeat_count} IDENTICAL WARNINGS/LOGS COMPRESSED BY CTS] ...")
                    i = j
                    match_found = True
                    break
        
        if not match_found:
            deduped_lines.append(lines[i])
            i += 1

    # 2. Stack traces (keep top 3, bottom 3)
    cleaned = []
    in_stack = False
    stack_buffer = []
    
    for line in deduped_lines:
        if line.strip().startswith('at ') or 'Traceback' in line or 'node_modules' in line:
            in_stack = True
            stack_buffer.append(line)
        else:
            if in_stack:
                if len(stack_buffer) > 6:
                    cleaned.extend(stack_buffer[:3]) # Top 3 lines (Preserves context!)
                    cleaned.append(f"... [{len(stack_buffer)-6} STACK TRACE LINES COMPRESSED BY CTS] ...")
                    cleaned.extend(stack_buffer[-3:]) # Bottom 3 lines (Preserves context!)
                else:
                    cleaned.extend(stack_buffer)
                stack_buffer = []
                in_stack = False
            cleaned.append(line)
            
    if in_stack:
        if len(stack_buffer) > 6:
            cleaned.extend(stack_buffer[:3])
            cleaned.append(f"... [{len(stack_buffer)-6} STACK TRACE LINES COMPRESSED BY CTS] ...")
            cleaned.extend(stack_buffer[-3:])
        else:
            cleaned.extend(stack_buffer)

    text = '\n'.join(cleaned)
    
    # 3. Base64
    text = re.sub(r'data:image\/[a-zA-Z]*;base64,[A-Za-z0-9+/=]+', '[BASE64_IMAGE_REMOVED]', text)
    
    # 4. Minified / Long lines (> 300 chars)
    final_lines = []
    for line in text.split('\n'):
        if len(line) > 300:
            # Keep first 150 chars and last 50 chars to preserve context (like JSON keys)
            final_lines.append(line[:150] + f" ... [LONG LINE OF {len(line)} CHARS TRUNCATED] ... " + line[-50:])
        else:
            final_lines.append(line)

    return '\n'.join(final_lines)

# --- GENERATORS FOR MASSIVE SEEDS ---

def generate_seed_1():
    # Massive React Error
    log = "User: Claude, the build failed with this massive error:\n"
    log += "TypeError: Cannot read properties of undefined (reading 'map')\n"
    for _ in range(1500):
        log += "  at Object.invokeGuardedCallbackProd (node_modules/react-dom/cjs/react-dom.production.min.js:14:11)\n"
    log += '  at renderComponent (src/App.tsx:42:15)\n'
    return log

def generate_seed_2():
    # Repetitive Webpack warnings (multi-line)
    log = "User: Webpack is throwing a million warnings.\n"
    warning = "WARNING in ./src/components/Button.tsx 42:15-20\nexport 'default' (imported as 'React') was not found in 'react'\n"
    log += warning * 600
    return log

def generate_seed_3():
    # Massive Base64 String
    log = "User: I added an image and it broke the parser.\n"
    log += "const img = 'data:image/png;base64," + ("aBcD" * 15000) + "';\n"
    log += "console.log('Done');\n"
    return log

def generate_seed_4():
    # Massive Minified JSON Dump
    log = "User: The API returned this error payload:\n"
    log += '{"error": "ValidationFailed", "details": "' + ("invalid_data " * 4000) + '", "code": 500}\n'
    return log

def generate_seed_5():
    log = generate_seed_1() + "\n" + generate_seed_2() + "\n" + generate_seed_4()
    return log

if __name__ == "__main__":
    print("--- REFINED DATASET TOKEN REDUCTION TEST ---\n")
    seeds = [generate_seed_1, generate_seed_2, generate_seed_3, generate_seed_4, generate_seed_5]
    
    for i, seed_fn in enumerate(seeds):
        text = seed_fn()
        orig_tokens = count_tokens(text)
        
        scraped = smart_scrape(text)
        new_tokens = count_tokens(scraped)
        
        reduction_pct = 100 - (new_tokens / orig_tokens * 100) if orig_tokens > 0 else 0
        
        print(f"Seed {i+1} Test:")
        print(f"  Before : {orig_tokens:,} tokens")
        print(f"  After  : {new_tokens:,} tokens")
        print(f"  Result : {reduction_pct:.2f}% reduction")
        
        # Print a tiny snippet of the output to prove context is retained
        print("  Snippet of what Claude sees:")
        print("    " + "\n    ".join(scraped.split('\n')[:4]))
        print("\n" + "="*50 + "\n")
