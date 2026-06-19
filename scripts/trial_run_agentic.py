import re

def count_tokens(text):
    return len(text.split())

def smart_scrape(text):
    lines = text.split('\n')
    
    # 1. Multi-line Deduper
    deduped_lines = []
    i = 0
    while i < len(lines):
        match_found = False
        for block_size in range(1, 6):
            if i + block_size <= len(lines):
                block = lines[i:i+block_size]
                repeat_count = 0
                j = i + block_size
                while j + block_size <= len(lines) and lines[j:j+block_size] == block:
                    if all(not line.strip() for line in block):
                        break
                    repeat_count += 1
                    j += block_size
                
                if repeat_count > 1:
                    deduped_lines.extend(block)
                    deduped_lines.append(f"... [{repeat_count} IDENTICAL BLOCKS COMPRESSED BY CTS] ...")
                    i = j
                    match_found = True
                    break
        
        if not match_found:
            deduped_lines.append(lines[i])
            i += 1

    # 2. Stack traces
    cleaned = []
    in_stack = False
    stack_buffer = []
    
    for line in deduped_lines:
        if line.strip().startswith('at ') or 'Traceback ' in line or 'node_modules' in line:
            in_stack = True
            stack_buffer.append(line)
        else:
            if in_stack:
                if len(stack_buffer) > 6:
                    cleaned.extend(stack_buffer[:3])
                    cleaned.append(f"... [{len(stack_buffer)-6} STACK TRACE LINES COMPRESSED BY CTS] ...")
                    cleaned.extend(stack_buffer[-3:])
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
    
    # 4. Long lines / Minified code
    final_lines = []
    for line in text.split('\n'):
        if len(line) > 300:
            final_lines.append(line[:100] + f" ... [LONG LINE OF {len(line)} CHARS TRUNCATED] ... " + line[-50:])
        else:
            final_lines.append(line)

    return '\n'.join(final_lines)

# --- CLAUDE CODE AGENTIC SIMULATIONS ---

def agent_seed_1():
    # Claude reading a massive file and getting a build error
    log = 'User: Fix the login button alignment\n'
    log += 'Assistant: <use_tool name="run_command" command="npm run build" />\n'
    log += 'Tool Output: \n'
    log += 'Failed to compile.\n'
    warning = "./src/App.tsx\nModule not found: Can't resolve 'react-router'\n"
    log += warning * 200 # Simulating massive repetitive build failure
    return log

def agent_seed_2():
    # Claude trying to debug an infinite loop in tests
    log = 'User: Run the jest tests.\n'
    log += 'Assistant: <use_tool name="run_command" command="npm test" />\n'
    log += 'Tool Output: \n'
    log += 'FAIL src/Login.test.tsx\n'
    for _ in range(800):
        log += "    at invokeGuardedCallbackProd (node_modules/react-dom/cjs/react-dom.production.min.js:14:11)\n"
    return log

def agent_seed_3():
    # Claude reads a file with a massive Base64 payload
    log = 'User: Why is the image not loading?\n'
    log += 'Assistant: <use_tool name="read_file" target="Header.tsx" />\n'
    log += 'Tool Output: \n'
    log += 'export const Header = () => {\n'
    log += "  const logo = 'data:image/png;base64," + ("xYzQ" * 15000) + "';\n"
    log += '  return <img src={logo} />;\n}'
    return log

def agent_seed_4():
    # Claude pulls massive unminified AWS JSON data from curl
    log = 'User: Hit the AWS endpoint and see what it returns.\n'
    log += 'Assistant: <use_tool name="run_command" command="curl https://api.aws.com/logs" />\n'
    log += 'Tool Output: \n'
    log += '{"statusCode": 500, "body": "' + ('error_timeout ' * 3000) + '"}\n'
    return log

def agent_seed_5():
    # Massive Node.js runtime crash
    log = 'User: Start the server.\n'
    log += 'Assistant: <use_tool name="run_command" command="node server.js" />\n'
    log += 'Tool Output: \n'
    log += 'FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory\n'
    for _ in range(300):
        log += ' 1: 0xb09c10 node::Abort() [node]\n 2: 0xa1c193 node::OnFatalError(char const*, char const*) [node]\n'
    return log

def agent_seed_6():
    # A combination of multiple agent steps (The Snowball Effect)
    log = agent_seed_1() + "\n" + agent_seed_2() + "\n" + agent_seed_5()
    return log

if __name__ == "__main__":
    print("--- CLAUDE CODE AGENTIC LOOP TOKEN REDUCTION ---")
    seeds = [agent_seed_1, agent_seed_2, agent_seed_3, agent_seed_4, agent_seed_5, agent_seed_6]
    
    total_orig = 0
    total_new = 0
    
    for i, seed_fn in enumerate(seeds):
        text = seed_fn()
        orig = count_tokens(text)
        new_toks = count_tokens(smart_scrape(text))
        
        total_orig += orig
        total_new += new_toks
        
        reduction = 100 - (new_toks / orig * 100) if orig > 0 else 0
        print(f"Seed {i+1} (Claude Agent Step {i+1}):")
        print(f"  Raw Token Cost : {orig:,} tokens")
        print(f"  CTS Token Cost : {new_toks:,} tokens")
        print(f"  Savings        : {reduction:.1f}%\n")

    overall = 100 - (total_new / total_orig * 100)
    print(f"OVERALL CONTEXT SAVINGS: {overall:.1f}%")
