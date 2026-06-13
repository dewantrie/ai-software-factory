# Profile: Quarkus Reactive + Hibernate Reactive Panache (backend-only)

Stack assumptions:
- Java 21 (LTS) — Java 17 also supported; bump `maven.compiler.release` in `pom.xml` accordingly
- Quarkus 3.x
- Mutiny — Quarkus's reactive primitives (`Uni<T>`, `Multi<T>`)
- Quarkus REST (formerly "RESTEasy Reactive"; renamed in Quarkus 3.9) for HTTP endpoints (`quarkus-rest`)
- Hibernate Reactive + Panache for persistence (`quarkus-hibernate-reactive-panache`)
- PostgreSQL via the reactive Vert.x driver (`quarkus-reactive-pg-client`)
- Flyway for migrations (`quarkus-flyway`)
- SmallRye Reactive Messaging (Kafka / RabbitMQ / AMQP) for async work; OR Quartz (`quarkus-quartz`) for scheduled
- Maven as build tool. Gradle is supported — substitute `./gradlew` for `mvn` in commands below.
- JUnit 5 + RestAssured (reactive variant) for tests
- Native image via GraalVM is supported but not required for dev

## Architecture rules

- REST endpoints (`@Path` resources) MUST return `Uni<T>` or `Multi<T>`. Never return `T` directly for I/O-bound endpoints.
- Database access goes through Hibernate Reactive (`Mutiny.SessionFactory`) or Panache reactive helpers. Do NOT mix blocking `EntityManager` / `Session` with the reactive stack.
- Demarcate transactions with the annotation your Quarkus version expects: on Quarkus 3.x reactive, use `@WithTransaction` (from `io.quarkus.hibernate.reactive.panache.common.runtime`). Note newer Quarkus adds reactive support for the standard Jakarta `@Transactional` and is deprecating the Panache reactive annotations — check your version's docs before picking. Whichever you choose, do not mix blocking and reactive transaction demarcation in the same flow.
- Business logic lives in `@ApplicationScoped` services. Resources (`@Path` classes) stay thin: parse input → call service → return Uni/Multi.
- Every database query touching tenant data MUST filter by `tenantId`. Either use a Panache filter (`@FilterDef` / `@Filter`) or a base repository that injects the predicate. Do NOT rely on session attributes that can be forgotten.
- DTOs at the API boundary — never expose Hibernate entities directly to clients. Map in the service layer.
- Errors: define typed exceptions extending an `AppException` base in `<group>/exceptions/`. Map to HTTP responses via `@ServerExceptionMapper`. Do NOT throw raw `RuntimeException` in production paths.
- IDs are server-generated UUIDs (`UUID.randomUUID()` or DB-side `gen_random_uuid()`).
- Input validation via Jakarta Bean Validation (`@Valid`, `@NotNull`, `@Size`, `@Pattern`) on resource method parameters and request DTOs.
- UTC everywhere; prefer `Instant` over `LocalDateTime` for stored timestamps.
- Money as `long` cents, or `BigDecimal` with fixed scale if fractional arithmetic is required. Be consistent across the codebase.
- Configuration values go through `@ConfigProperty`. Never hardcode environment-specific values.

## Don't do

- Do not block a reactive type with `.await().indefinitely()`, `.subscribe().asCompletionStage().get()`, or any other blocking call in production paths. Allowed only in unit tests with explicit `awaitable` helpers.
- Do not return blocking types (raw `T`, `List<T>`, `Optional<T>`) from REST methods that touch the DB. Wrap in `Uni`/`Multi`.
- Do not mix blocking and reactive transaction demarcation in one flow (see the transaction rule above for the version-appropriate annotation).
- Do not inject the blocking `EntityManager` or `Session` in reactive resources/services.
- Do not log full request bodies for billing or auth endpoints.
- Do not write raw SQL outside of explicit Hibernate/Panache helpers (`PanacheQuery.executeUpdate`, `nativeQuery`).
- Do not catch `Throwable` or bare `Exception` — be specific.
- Do not introduce new Quarkus extensions or third-party libs without approval (and confirm native-image compatibility if you build native images).
- Do not commit `.env`, `application-secrets.properties`, `*.key`, or `*.pem` files.
- Do not put business rules in the REST resource — those belong in services.
- Do not use field injection (`@Inject` on fields) in services; prefer constructor injection for testability.

## Conventions

- Package layout: `<group>.<feature>.{resources,services,repositories,dto,model,exceptions}`. Package by feature, not by layer.
- Naming: DTOs end in `Dto` / `Request` / `Response`. Services in `Service`. Resources in `Resource`. Repositories in `Repository`. Entities have no suffix.
- Test files end in `Test` (unit, runs in `mvn test`) or `IT` (integration, runs in `mvn verify` via Failsafe).
- Imports: group by package, no wildcards.
- Constructor injection over field injection (Quarkus supports both; prefer the former).
- `application.properties` is split per profile: `application.properties` (common), `application-dev.properties`, `application-prod.properties`.

## Default paths (override in manifest)

```yaml
paths:
  backend:
    - src/main/java/**
    - src/main/resources/**             # app config, META-INF, seed data (db/ also owned by migrations)
  frontend: []                        # backend-only
  migrations:                         # Migration Author owns Flyway/Liquibase migrations
    - src/main/resources/db/**
  infra:                              # DevOps Builder owns CI/CD + container/IaC
    - src/main/docker/**
    - Dockerfile
    - .github/workflows/**
  tests:
    - src/test/java/**
    - src/integrationTest/java/**     # if using Gradle's integrationTest sourceSet
  docs:                               # Doc Writer owns docs + changelog
    - docs/**
    - CHANGELOG.md
    - README.md
  forbidden:
    - .env*
    - "**/application-secrets.properties"
    - "**/*.pem"
    - "**/*.key"
```

## Default commands (override in manifest)

```yaml
commands:
  typecheck: mvn compile -q -DskipTests
  lint: mvn spotbugs:check -q   # requires the spotbugs-maven-plugin in pom.xml; otherwise swap for your project's linter (checkstyle/PMD) or drop
  test: mvn test -q
  acceptance: mvn verify -q
```

(Gradle equivalents: `./gradlew compileJava`, `./gradlew check`, `./gradlew test`, `./gradlew integrationTest`. Update the manifest commands accordingly.)
