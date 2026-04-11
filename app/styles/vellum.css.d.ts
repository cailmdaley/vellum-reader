// CSS modules imported via Remix `links` are resolved at build time to a URL
// string. This ambient declaration teaches TypeScript about that default
// export so `import vellumCss from '~/styles/vellum.css'` type-checks.
declare const href: string;
export default href;
