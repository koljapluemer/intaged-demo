Empty uv scaffold.
Make a flask app, with a simple vue+vite+ts+tailwind+daisy+lucide-icons frontend, following recommended simple patterns.

I want to demo a document editing experience that is basically markdown, but the user can define blocks ```intaged that get interpreted in a special way.
For the editor, use tiptap with markdown extension https://tiptap.dev/docs/editor/markdown. 

The aforementioned block should be interpreted as a spec for a small sandboxed visualization (full HTML/CSS/JS) that is implemented by an AI.
For now, just hardcode usage of the openai api, with key loaded from .env in the repo.
Research what kind of calls should be made to reliably convert the spec into a small html/css/js widget. 

Such a block should first show up as just an empty box on the live preview, with a little icon button to (re)generate its content agentically. 
Clicking this button should regenerate it and actually show it.
For now, simply save the generated html/css/js code in localstorage; while the spec is of course part of the document.
I think for now documents should simply live in a hardcoded gitignored folder in this repo.
