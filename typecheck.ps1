$result = & node node_modules/typescript/bin/tsc --noEmit 2>&1
if ($result) {
    Write-Output "TYPE ERRORS:"
    $result | ForEach-Object { Write-Output $_ }
} else {
    Write-Output "No type errors found"
}
