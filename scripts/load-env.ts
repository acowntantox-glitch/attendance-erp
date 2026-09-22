import { config } from "dotenv";

// Must be its own module, imported FIRST (before any module that transitively imports
// `@/config/env`, e.g. `../src/db/client`). ES module imports are hoisted and evaluated in
// declaration order regardless of where plain statements sit in the file, so calling
// `config()` inline before other imports in the same file does NOT run before those imports'
// module bodies execute — only a separate, earlier-imported module's side effects are
// guaranteed to run first.
config({ path: ".env.local" });
config({ path: ".env" });
