# Скрипты обслуживания репозитория

Здесь размещаются исключительно скрипты обслуживания репозитория.

- [ompcli-runtime/](ompcli-runtime/README.md) — скачивание и проверка закреплённых Windows-файлов.
- [ompcli-build/](ompcli-build/index.js) — сборка staging расширения VS Code `dist/ompcli`: файлы манифеста, payload харнеса, CPU-сервер llama.cpp с DLL и CRT.

Это не набор tools продукта и не часть установки OMP. Скрипты не переиспользуют внутренности продукта; граница определена в [AGENTS.md](../../AGENTS.md).
