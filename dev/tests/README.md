# Автоматические тесты

Все автоматические тесты находятся в служебном дереве и не устанавливаются в OMP.

- [harness/](harness/README.md) — тесты наблюдаемого поведения модулей продукта.
- [repository/](repository/README.md) — тесты служебных инструментов.
- `install/` — тесты манифеста поставки [install.manifest.json](../../install.manifest.json).

Раннер: `bun test`. Сценарии и свидетельства ручной и интеграционной приёмки хранятся отдельно в [acceptance/](../acceptance/README.md).
