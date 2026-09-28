# Frontend

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.12.

## Development server

The public terms and conditions PDF URL is configured by `TERMS_AND_CONDITIONS_URL` in `.env.example`. To override it locally, create a `.env` in this directory with the same key, or set the environment variable. Environment variables take precedence over `.env`, which takes precedence over `.env.example`. The `npm start`, `npm run build`, and `npm run watch` scripts embed this URL in the Angular bundle at build time; restart the server after changing it. Do not store secrets here because the URL is visible to browsers.

To start a local development server, run:

```bash
npm start
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
