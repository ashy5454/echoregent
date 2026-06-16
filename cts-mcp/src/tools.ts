export function smartScrape(text: string): string {
    const lines = text.split('\n');
    const dedupedLines: string[] = [];
    let i = 0;

    // 1. Multi-line Deduper
    while (i < lines.length) {
        let matchFound = false;
        for (let blockSize = 1; blockSize <= 5; blockSize++) {
            if (i + blockSize <= lines.length) {
                const block = lines.slice(i, i + blockSize);
                let repeatCount = 0;
                let j = i + blockSize;
                
                while (j + blockSize <= lines.length) {
                    const nextBlock = lines.slice(j, j + blockSize);
                    if (block.every((val, index) => val === nextBlock[index])) {
                        // Ignore empty repeating blocks
                        if (block.every(line => line.trim() === '')) {
                            break;
                        }
                        repeatCount++;
                        j += blockSize;
                    } else {
                        break;
                    }
                }
                
                if (repeatCount > 1) {
                    dedupedLines.push(...block);
                    dedupedLines.push(`... [${repeatCount} IDENTICAL BLOCKS COMPRESSED BY CTS] ...`);
                    i = j;
                    matchFound = true;
                    break;
                }
            }
        }
        
        if (!matchFound) {
            dedupedLines.push(lines[i]);
            i++;
        }
    }

    // 2. Stack traces
    const cleaned: string[] = [];
    let inStack = false;
    let stackBuffer: string[] = [];

    for (const line of dedupedLines) {
        if (line.trim().startsWith('at ') || line.includes('Traceback ') || line.includes('node_modules') || line.includes('File "')) {
            inStack = true;
            stackBuffer.push(line);
        } else {
            if (inStack) {
                if (stackBuffer.length > 6) {
                    cleaned.push(...stackBuffer.slice(0, 3));
                    cleaned.push(`... [${stackBuffer.length - 6} STACK TRACE LINES COMPRESSED BY CTS] ...`);
                    cleaned.push(...stackBuffer.slice(-3));
                } else {
                    cleaned.push(...stackBuffer);
                }
                stackBuffer = [];
                inStack = false;
            }
            cleaned.push(line);
        }
    }
    
    if (inStack) {
        if (stackBuffer.length > 6) {
            cleaned.push(...stackBuffer.slice(0, 3));
            cleaned.push(`... [${stackBuffer.length - 6} STACK TRACE LINES COMPRESSED BY CTS] ...`);
            cleaned.push(...stackBuffer.slice(-3));
        } else {
            cleaned.push(...stackBuffer);
        }
    }

    let result = cleaned.join('\n');

    // 3. Base64
    result = result.replace(/data:image\/[a-zA-Z]*;base64,[A-Za-z0-9+/=]+/g, '[BASE64_IMAGE_REMOVED]');

    // 4. Long lines
    const finalLines: string[] = [];
    for (const line of result.split('\n')) {
        if (line.length > 300) {
            finalLines.push(line.substring(0, 150) + ` ... [LONG LINE OF ${line.length} CHARS TRUNCATED] ... ` + line.substring(line.length - 50));
        } else {
            finalLines.push(line);
        }
    }

    return finalLines.join('\n');
}
