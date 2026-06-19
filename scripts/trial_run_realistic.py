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
        if line.strip().startswith('at ') or 'Traceback ' in line or 'node_modules' in line or 'File "' in line:
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
    
    # 4. Long lines
    final_lines = []
    for line in text.split('\n'):
        if len(line) > 300:
            final_lines.append(line[:150] + f" ... [LONG LINE OF {len(line)} CHARS TRUNCATED] ... " + line[-50:])
        else:
            final_lines.append(line)

    return '\n'.join(final_lines)

# --- REALISTIC SCENARIOS ---

def get_scenario_1():
    # Real Python Traceback (Deep Recursion / Framework error)
    log = "Claude, I'm trying to run my Django app and getting this error:\n"
    log += 'Traceback (most recent call last):\n'
    log += '  File "manage.py", line 22, in <module>\n'
    log += '    main()\n'
    log += '  File "manage.py", line 18, in main\n'
    log += '    execute_from_command_line(sys.argv)\n'
    for i in range(40):
        log += f'  File "/usr/local/lib/python3.9/site-packages/django/core/management/__init__.py", line {419-i}, in execute_from_command_line\n'
        log += '    utility.execute()\n'
    log += '  File "/app/myproject/settings.py", line 42, in <module>\n'
    log += '    import missing_package\n'
    log += 'ModuleNotFoundError: No module named "missing_package"\n'
    return log

def get_scenario_2():
    # Real React Infinite Loop (Maximum update depth exceeded)
    log = "Help, my React page freezes and crashes.\n"
    log += "Warning: Maximum update depth exceeded. This can happen when a component calls setState inside useEffect, but useEffect either doesn't have a dependency array, or one of the dependencies changes on every render.\n"
    for _ in range(50):
        log += "    at App (http://localhost:3000/static/js/bundle.js:152:61)\n"
        log += "    at renderWithHooks (http://localhost:3000/static/js/bundle.js:14555:18)\n"
        log += "    at updateFunctionComponent (http://localhost:3000/static/js/bundle.js:17622:20)\n"
    return log

def get_scenario_3():
    # Real Webpack / ESLint nightmare dump
    log = "I tried to build my Next.js app and got 50 linting errors.\n"
    warning = "./src/components/Navbar.tsx\n45:10  Warning: React Hook useEffect has a missing dependency: 'fetchData'. Either include it or remove the dependency array.  react-hooks/exhaustive-deps\n"
    log += warning * 40
    return log

def get_scenario_4():
    # AWS Lambda massive API JSON error
    log = "The AWS API returned a massive 500 error payload.\n"
    log += '{"message": "Internal Server Error", "requestId": "abc-123", "trace": "'
    log += 'at Object.handler (/var/task/index.js:45:12)\\n' * 50
    log += '", "context": {"user": "admin", "permissions": [' + '"read", '*200 + ']}, "statusCode": 500}\n'
    return log

if __name__ == "__main__":
    print("--- REALISTIC DATASET TOKEN REDUCTION TEST ---\n")
    scenarios = [get_scenario_1, get_scenario_2, get_scenario_3, get_scenario_4]
    
    total_orig = 0
    total_new = 0
    
    for i, s_fn in enumerate(scenarios):
        text = s_fn()
        orig = count_tokens(text)
        new_toks = count_tokens(smart_scrape(text))
        total_orig += orig
        total_new += new_toks
        
        reduction = 100 - (new_toks / orig * 100) if orig > 0 else 0
        print(f"Scenario {i+1}: {orig} tokens -> {new_toks} tokens ({reduction:.1f}% reduction)")

    overall_reduction = 100 - (total_new / total_orig * 100)
    print(f"\nOVERALL REALISTIC REDUCTION: {overall_reduction:.1f}%")
