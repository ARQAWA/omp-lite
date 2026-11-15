# Скрипты обслуживания репозитория

Здесь размещаются исключительно скрипты обслуживания репозитория.

- [rqw-windows-pack/runtime/](rqw-windows-pack/runtime/index.js) — скачивание закреплённых Windows-файлов с проверкой размера и SHA-256. Пины берёт из `runtime.json` модуля через `install.manifest.json`.
- [rqw-windows-pack/build/](rqw-windows-pack/build/index.js) — сборка папки расширения VS Code `dist/ompcli`: файлы манифеста, копия харнеса, `omp.exe`, `ffmpeg.exe`, сервер llama.cpp с DLL и CRT. Нужны чистое рабочее дерево и `cabextract`.

Это не набор tools продукта и не часть установки OMP. Скрипты не переиспользуют внутренности продукта; граница определена в [AGENTS.md](../../AGENTS.md).
