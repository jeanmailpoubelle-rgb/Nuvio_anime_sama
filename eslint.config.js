module.exports = [{ ignores:['test/fixtures/**'] }, {
  files: ['src/**/*.js', 'scripts/**/*.js', 'test/**/*.js'],
  languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: Object.fromEntries(
    ['module','require','exports','process','console','fetch','URL','URLSearchParams','setTimeout','clearTimeout','AbortController','AbortSignal','Uint8Array','DataView','TextEncoder','TextDecoder','Buffer','atob','btoa','SCRAPER_SETTINGS','TMDB_API_KEY','__native_fetch','__dirname','__filename','Intl','Response','ReadableStream'].map(k => [k, 'readonly'])) },
  rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }], 'no-undef': 'error', 'no-unreachable': 'error', 'eqeqeq': ['error', 'always', {null: 'ignore'}] }
}];
