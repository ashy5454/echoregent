import re

def count_tokens(text):
    return len(text.split())

def smart_scrape(text):
    # 1. Stack traces (keep top 5, bottom 5)
    lines = text.split('\n')
    cleaned = []
    in_stack = False
    stack_buffer = []
    
    for line in lines:
        if line.strip().startswith('at ') or 'Traceback' in line or 'node_modules' in line:
            in_stack = True
            stack_buffer.append(line)
        else:
            if in_stack:
                if len(stack_buffer) > 10:
                    cleaned.extend(stack_buffer[:5])
                    cleaned.append(f"... [{len(stack_buffer)-10} STACK TRACE LINES COMPRESSED BY CTS] ...")
                    cleaned.extend(stack_buffer[-5:])
                else:
                    cleaned.extend(stack_buffer)
                stack_buffer = []
                in_stack = False
            cleaned.append(line)
            
    if in_stack:
        if len(stack_buffer) > 10:
            cleaned.extend(stack_buffer[:5])
            cleaned.append(f"... [{len(stack_buffer)-10} STACK TRACE LINES COMPRESSED BY CTS] ...")
            cleaned.extend(stack_buffer[-5:])
        else:
            cleaned.extend(stack_buffer)

    text = '\n'.join(cleaned)
    
    # 2. Base64
    text = re.sub(r'data:image\/[a-zA-Z]*;base64,[A-Za-z0-9+/=]+', '[BASE64_IMAGE_REMOVED]', text)
    
    # 3. Minified / Long lines (> 300 chars)
    final_lines = []
    for line in text.split('\n'):
        if len(line) > 300:
            final_lines.append(line[:100] + f" ... [LONG LINE OF {len(line)} CHARS TRUNCATED] ... " + line[-50:])
        else:
            final_lines.append(line)
            
    # 4. Repeated log lines (e.g. "Warning: module not found" x 1000)
    deduped = []
    last_line = ""
    repeat_count = 0
    for line in final_lines:
        if line == last_line and len(line) > 10:
            repeat_count += 1
        else:
            if repeat_count > 3:
                deduped.append(f"... [PREVIOUS LINE REPEATED {repeat_count} TIMES] ...")
            elif repeat_count > 0:
                deduped.extend([last_line] * repeat_count)
            deduped.append(line)
            last_line = line
            repeat_count = 0
            
    if repeat_count > 3:
        deduped.append(f"... [PREVIOUS LINE REPEATED {repeat_count} TIMES] ...")
            
    return '\n'.join(deduped)

# --- GENERATORS FOR MASSIVE SEEDS ---

def generate_seed_1():
    # Massive React Error (approx 6000 tokens)
    log = "User: Claude, the build failed with this massive error:\n"
    for _ in range(1500):
        log += "  at Object.invokeGuardedCallbackProd (node_modules/react-dom/cjs/react-dom.production.min.js:14:11)\n"
    log += 'const data = {"payload": "' + ('x ' * 4000) + '"};\n'
    return log

def generate_seed_2():
    # Repetitive Webpack warnings (approx 8000 tokens)
    log = "User: Webpack is throwing a million warnings.\n"
    warning = "WARNING in ./src/components/Button.tsx 42:15-20\nexport 'default' (imported as 'React') was not found in 'react'\n"
    log += warning * 600
    return log

def generate_seed_3():
    # Massive Base64 String in a component (approx 10000+ tokens equivalent)
    log = "User: I added an image and it broke the parser.\n"
    log += "const img = 'data:image/png;base64," + ("aBcD" * 15000) + "';\n"
    log += "console.log('Done');\n"
    return log

def generate_seed_4():
    # Massive Minified JSON Dump (approx 4000 tokens)
    log = "User: The API returned this error payload:\n"
    log += '{"error": "ValidationFailed", "details": "' + ("invalid_data " * 4000) + '"}\n'
    return log

def generate_seed_5():
    # Mixed Bag: Stack trace + repeated logs + minified code (approx 18000 tokens)
    log = generate_seed_1() + "\n" + generate_seed_2() + "\n" + generate_seed_4()
    return log

if __name__ == "__main__":
    print("--- MASSIVE DATASET TOKEN REDUCTION TEST ---\n")
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
        print(f"  Result : {reduction_pct:.2f}% reduction\n")
