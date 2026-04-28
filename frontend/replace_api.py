import os, glob, re

for filepath in glob.glob('src/**/*.jsx', recursive=True):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    if 'http://localhost:8000' in content:
        # Replace 'http://localhost:8000...' with `${import.meta.env.VITE_API_URL}...`
        content = re.sub(r"'http://localhost:8000([^']*)'", r"`${import.meta.env.VITE_API_URL}\1`", content)
        content = re.sub(r"`http://localhost:8000([^`]*)`", r"`${import.meta.env.VITE_API_URL}\1`", content)
        content = re.sub(r'"http://localhost:8000([^"]*)"', r"`${import.meta.env.VITE_API_URL}\1`", content)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'Updated {filepath}')
