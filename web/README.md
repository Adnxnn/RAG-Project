# RAG Project Web UI

Next.js 14, TypeScript, Tailwind CSS and shadcn-compatible project structure.

## Component paths

- Reusable UI components: `components/ui`
- App routes and global styles: `app`
- Global stylesheet: `app/globals.css`

Keeping shadcn components in `components/ui` preserves standard CLI aliases, predictable imports, and easier future component updates.

## Run

```bash
cd web
npm install
npm run dev
```

Open `http://localhost:3000`.

## Optional shadcn initialization

The frontend already has the expected folder structure. To add `components.json` and install future shadcn components interactively:

```bash
npx shadcn@latest init
```

Choose `app/globals.css` for the global stylesheet and `components/ui` for components.

## Browser requirement

The hero uses Three.js WebGPU/TSL. Use a current browser with WebGPU support. A production version should add a WebGL or static-image fallback for unsupported browsers.
