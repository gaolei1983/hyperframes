#!/usr/bin/env python3
"""Build a template picker HTML from the template and injected data.

Usage:
    python3 build-template-picker.py \
        --template skills/hyperframes/templates/template-picker.html \
        --templates-dir /path/to/beautiful-html-templates/templates \
        --output .hyperframes/template-picker.html \
        < data.json

data.json must contain:
    { "palettes": [...], "prompt_text": {...}, "prompt_desc": "..." }

The script reads index.json from templates-dir parent, extracts CSS color vars
from each template, and injects all data into the HTML template.
"""
import json, sys, re, os, argparse

def extract_color_vars(html_path):
    with open(html_path) as f:
        html = f.read()
    root_match = re.search(r':root\s*\{([^}]+)\}', html)
    if not root_match:
        return []
    return [m[0] for m in re.findall(r'(--[\w-]+)\s*:\s*([^;]+)', root_match.group(1))
            if '#' in m[1] or 'rgb' in m[1]]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--template', required=True)
    parser.add_argument('--templates-dir', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()

    data = json.load(sys.stdin)

    index_path = os.path.join(os.path.dirname(args.templates_dir), 'index.json')
    with open(index_path) as f:
        index = json.load(f)

    templates = []
    for t in index['templates']:
        html_path = os.path.join(args.templates_dir, t['slug'], 'template.html')
        if not os.path.exists(html_path):
            continue
        templates.append({
            'slug': t['slug'],
            'name': t['name'],
            'tagline': t['tagline'],
            'scheme': t['scheme'],
            'density': t['density'],
            'colorVars': extract_color_vars(html_path)
        })

    with open(args.template) as f:
        html = f.read()

    html = html.replace('__PALETTES_JSON__', json.dumps(data['palettes']))
    html = html.replace('__PROMPT_TEXT_JSON__', json.dumps(data['prompt_text']))
    html = html.replace('__TEMPLATES_JSON__', json.dumps(templates))
    html = html.replace('__PROMPT_DESC__', data.get('prompt_desc', ''))

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, 'w') as f:
        f.write(html)

    print(f"Written to {args.output} ({len(templates)} templates)")

if __name__ == '__main__':
    main()
