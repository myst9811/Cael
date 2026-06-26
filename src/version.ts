// BUILD_VERSION is injected at compile time via --define BUILD_VERSION='"v1.2.3"'.
// Falls back to "dev" when running via `bun run index.ts`.
declare const BUILD_VERSION: string;
export const VERSION: string = typeof BUILD_VERSION !== "undefined" ? BUILD_VERSION : "dev";

export function printVersion(): void {
  console.log(`cael ${VERSION}`);
}
