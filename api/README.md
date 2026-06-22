<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Monthly Participation Data Source

The `GET /participation/monthly` endpoint supports two source modes:

- Local folder (default)
- Azure Blob Storage container

### Local folder mode (default)

Set `OP_PARTICIPATION_ROOT_PATH` to a local path containing month subfolders (for example `June`, `July`) with `.txt` files:

```bash
OP_PARTICIPATION_ROOT_PATH=src/data/OPParticipation
```

### Azure Blob Storage mode

Set the variables below to read from an Azure Storage account container:

```bash
OP_PARTICIPATION_AZURE_STORAGE_ACCOUNT=seeturtlesphsa
OP_PARTICIPATION_AZURE_CONTAINER=spa
OP_PARTICIPATION_AZURE_PREFIX=2026
```

Notes:

- The container should contain month subfolders under the configured prefix (for example `2026/June`).
- Each month subfolder should contain `.txt` participation files.
- If both `OP_PARTICIPATION_AZURE_STORAGE_ACCOUNT` and `OP_PARTICIPATION_AZURE_CONTAINER` are set, Azure mode is used; otherwise local mode is used.

### Local development setup

The API now auto-loads environment variables from `api/.env`.

1. Create `api/.env` from `api/.env.example`.
2. Set your values:

```bash
OP_PARTICIPATION_AZURE_STORAGE_ACCOUNT=seeturtlesphsa
OP_PARTICIPATION_AZURE_CONTAINER=spa
OP_PARTICIPATION_AZURE_PREFIX=2026
```

3. Start the API as usual:

```bash
npm run start:dev
```

### Reference CSV sync and participant mapping

On queue refresh (`GET /queue`), the API downloads and refreshes local copies of two reference CSV files.
On participant import (`POST /queue/import-participants`), it refreshes these files first, then maps pasted
participants using this flow:

1. Match participant name to membership CSV `Reclub Name`.
2. Read `Skill Level (Self Assesment)` and store it as `skillLevel` (or `N/A` if unmatched/unknown).
3. Read membership `DUPR ID`.
4. Match that `DUPR ID` in the DUPR ratings CSV and read `doubles` into `dupr`.

Configuration:

```bash
OP_PARTICIPATION_DUPR_BLOB_PATH=SPADUPR/members-list-sorsogonpickleballclub.csv
OP_PARTICIPATION_CLUB_MEMBERSHIP_BLOB_PATH=SPADUPR/Sorsogon Pickleball Club Member Registration (Responses) - Form Responses 1.csv

DUPR_MEMBERS_LOCAL_FILE_PATH=src/data/members-list-sorsogonpickleballclub.csv
CLUB_MEMBERSHIP_LOCAL_FILE_PATH=src/data/Sorsogon Pickleball Club Member Registration (Responses) - Form Responses 1.csv

PLAYER_LIST_FILE_PATH=src/data/players.json
```

Notes:

- If no membership row matches a pasted participant, `skillLevel` becomes `N/A` and `dupr` remains `null`.
- Import resets rounds/matches and overwrites the local players file.
- Queue refresh sync is best-effort and does not block queue operations if Azure is temporarily unavailable.

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
