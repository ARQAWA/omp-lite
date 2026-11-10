# omp-lite

omp-lite — модульный обвес для OMP: расширения, навыки, системный промпт и настройки.

В [`src/modules/`](src/modules/README.md) лежат 20 модулей, каждый описан своим README. Харнес ставится в установленный OMP по [INSTALL.md](INSTALL.md). Состав поставки задаёт [install.manifest.json](install.manifest.json).

Сборки харнеса нет: файлы копируются из `src/`. Отдельно собирается только расширение VS Code `arqawa.ompcli` для Windows VDI, модуль [`ompcli`](src/modules/ompcli/README.md).

| Зона | Назначение |
| --- | --- |
| Корень | Входная документация; не устанавливаемый пакет |
| [`dev/`](dev/README.md) | Среда разработки: настройки, материалы агентов, скрипты, все тесты и приёмка |
| [`src/`](src/README.md) | Исходники продукта: модули и их ресурсы |

Разработчику: [AGENTS.md](AGENTS.md). Установщику: [INSTALL.md](INSTALL.md).
Полная навигация: [INDEX.md](INDEX.md).
