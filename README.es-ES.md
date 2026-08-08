

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="site/brand/wordmark-dark.svg">
  <img alt="receipts" src="site/brand/wordmark-light.svg" width="380">
</picture>

**Tu agente de código con IA utilizó millones de tokens. Este es el suelo de costo observable.**

[![CI](https://github.com/anandgupta42/receipts/actions/workflows/ci.yml/badge.svg)](https://github.com/anandgupta42/receipts/actions/workflows/ci.yml) [![npm](https://img.shields.io/npm/v/aireceipts-cli.svg)](https://www.npmjs.com/package/aireceipts-cli) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

<a href="https://github.com/anandgupta42/receipts/pull/189#issuecomment-4921391222">
  <img alt="A real aireceipts receipt comment on a merged pull request: three attributed sessions, including a Claude Code orchestrator slice and two Codex helpers. This historical screenshot predates the current lower-bound notation." src="docs/assets/pr-receipt-189.png" width="480">
</a>

<sub>no es un boceto: un recibo real en una PR fusionada de este repositorio. Esta captura precede a la notación actual `≥ $X`.
<a href="https://github.com/anandgupta42/receipts/pull/189#issuecomment-4921391222">Léelo en vivo.</a></sub>

**El taxímetro corre mientras el agente conduce · el recibo se imprime cuando termina el viaje · y se queda con la PR**

</div>

**Por qué existe esto.** El uso de agentes de código con IA suele ser invisible: ves el diff, no el registro de tokens. aireceipts reconstruye un suelo de precio de lista observable de la API estándar: en vivo en tu barra de estado, detallado al finalizar la sesión, adjunto a la PR. No es una factura ni una asignación de suscripción. Local y determinista: las transcripciones nunca salen de tu máquina, y un recibo compartido lleva cifras más el título de una línea de la sesión (extraído de tu prompt inicial, truncado): nunca tu diff, el contenido de archivos o la transcripción ([cómo](docs/pr-receipts.md)).


## Comienza aquí: el taxímetro, el recibo, la PR

Pruébalo en diez segundos: `npx aireceipts-cli` — sin instalación, sin cuenta (`--demo` muestra un ejemplo incluido si aún no tienes sesiones). Luego déjalo funcionar como un viaje en taxi:

**1 · Mientras el agente trabaja: el taxímetro.** Una línea de configuración ([configuración](docs/statusline.md)) fija `aireceipts statusline` debajo de la caja de entrada de Claude Code; y tmux, starship o PowerShell le dan a Codex y OpenCode la misma barra, que va sumando mientras dura la sesión:

<p align="center"><img alt="Historical terminal recording of an agent session with the aireceipts statusline highlighted. The Standard-API-equivalent floor rises during the run and a Bash loop ×5 flag appears; this recording predates the current ≥ notation. Tokens and waste are reconstructed from the transcript; host-supplied payload fields are simulated." src="site/assets/statusline.gif" width="640"></p>

La línea, segmento por segmento:

```
[aireceipts] Opus · ≥$4.20 · ≥$9/hr · 128k · ctx 42% · 5h 24% ↺2h13m
             │      │       │       │      │         └ cuánto de tu límite de 5 horas se ha usado · cuándo se reinicia
             │      │       │       │      └ qué tan llena está la ventana de contexto
             │      │       │       └ cuántos tokens ha usado la sesión
             │      │       └ suelo observable de la API estándar por hora
             │      └ suelo observable hasta ahora: precios citados, subagentes incluidos
             └ qué modelo está activo en este momento
```

Cuando un detector encuentra un bucle de reintentos atascado, aparece una bandera de patrón heurístico directamente en la línea; es evidencia para inspeccionar, no una afirmación de ahorro probado.


**2 · Cuando termina la sesión: el recibo.** `npx aireceipts-cli` imprime el recibo detallado: suelos citados en filas de herramientas con precio, contenedores solo de tokens donde la evidencia es insuficiente, patrones heurísticos señalados (bucles, fricción de contexto, intervalos triviales) y la línea del modelo más barato como aritmética, no como predicción. Los bytes exactos:

```
- - - - - - - - - - - - - - - - - - - - - - - - -
                    AIRECEIPTS                     
 “Add email format validation to the signup for…” 
 Claude Code · Jun 18 2026 09:30:30 UTC · 10m 30s 
    claude-opus-4-8 87% · claude-sonnet-5 13%     
         cache served 85% of input tokens         

pre-edit: 11% of priced floor (1/10 turns)
  (share before the first named edit tool)

Bash..........................≥ $0.0517  (3 calls)
Edit..........................≥ $0.0455  (2 calls)
(thinking/reply)..............≥ $0.0310  (2 turns)
Write.........................≥ $0.0290  (2 calls)
Read...........................≥ $0.0192  (1 call)
--------------------------------------------------
TOTAL....................................≥ $0.1764
standard API-equivalent floor; not an invoice
same tokens on claude-haiku-4-5..........≥ $0.0392
  (78% lower observable floor)
  (arithmetic, not a prediction)
- - - - - - - - - - - - - - - - - - - - - - - - -
                npx aireceipts-cli                
         github.com/anandgupta42/receipts         
- - - - - - - - - - - - - - - - - - - - - - - - -
```

La línea final identifica el proyecto de código abierto que generó el recibo; la línea anterior es el comando de instalación. Los comentarios de PR y sus artefactos HTML hacen que el mismo destino de código e instalación sea clicable.

Cada `≥ $X` para humanos se redondea hacia abajo. Las filas de gasto aditivo comparten una precisión adaptativa: dos decimales para centavos exactos, normalmente cuatro para centavos fraccionarios y hasta doce para evidencias positivas mínimas — y suman visiblemente un `TOTAL` que nunca supera el agregado crudo de la máquina. Ninguna fila se redondea hacia arriba; si la suma en punto flotante se serializa justo por debajo de la suma de la unidad de la fila, la fila más grande se reduce por la unidad(s) excedente(s). `--json`/`--csv` mantienen la precisión cruda y semánticas de límite inferior explícitas.

<sub>`pre-edit` es la participación del suelo de precio observable antes de la primera llamada a la herramienta de edición ([leyendo un recibo](docs/guide/04-read-a-receipt.md)).</sub>

**3 · Cuando se envía la PR: el recibo se queda con ella.** `npx aireceipts-cli pr --post` adjunta el suelo de costo observable de las sesiones detrás de una PR como un comentario. La generación se mantiene local; una [verificación CI](docs/adopt/pr-receipt-check-caller.yml) de instalación fácil puede requerir que cada PR lleve uno: uno real, en vivo: [PR #189](https://github.com/anandgupta42/receipts/pull/189#issuecomment-4921391222). ¿Quieres que sea automático? Un [gancho pre-push](docs/pr-receipts.md#in-your-own-repo-any-agent-paste-ready) listo para pegar adjunta la referencia del recibo cada vez que una sesión local coincide con la rama enviada, desde cualquier agente, y la verificación CI publica el comentario por ti.

## Qué te dice

- **Qué modelo está activo, y el suelo de la API estándar observable hasta ahora** — en cada prompt, antes de que termine la sesión, con la cuenta regresiva de tu límite de 5 horas al lado.
- **Dónde fue el uso observable** — las filas con precio llevan suelos `≥` citados; los componentes sin coincidir o sin atribuir se mantienen como tokens. Las banderas heurísticas identifican bucles atascados, fricción de contexto y turnos triviales sin afirmar que sean evitables.
- **El suelo observable detrás de una PR** — atribuido a lo largo de las sesiones que la construyeron, con aritmética de los mismos tokens en un modelo más barato.

## Agentes compatibles

| Agente | Profundidad |
|---|---|
| [Claude Code](docs/agents/claude-code.md) | Completa: modelos, herramientas y niveles de caché por turno |
| [Codex CLI](docs/agents/codex.md) | Análisis por turno con precios de nivel de contexto a granularidad de solicitud; el uso de escritura de caché está ausente en las trazas |
| [Gemini CLI](docs/agents/gemini.md) | Completa: modelos, herramientas y tokens de caché por turno |
| [OpenCode](docs/agents/opencode.md) | Completa: modelos, herramientas y lectura/escritura de caché por mensaje; los residuales solo agregados permanecen sin atribuir/solo tokens |
| [Cursor](docs/agents/cursor.md) | Modo degradado honesto: solo totales de sesión (sus registros no llevan uso por turno) |

Los precios de los modelos cambian. Una alerta diaria verifica `data/prices/` contra un conjunto de datos independiente y abre un issue cuando discrepan; cada cambio de tabla se publica como una PR de tabla de precios citada.
## Instalación: o deja que tu agente lo haga

```sh
npm i -g aireceipts-cli
```

Sin cuenta, sin clave API. El comando luego es `aireceipts`; o salta la instalación y anteponga cualquier comando como `npx aireceipts-cli`. Guía completa: [para empezar](docs/guide/01-getting-started.md).

### La más fácil: deja que tu agente lo haga

Ya tienes un agente de código con IA. En Claude Code, Codex o cualquier agente con acceso a shell, pega:

```text
Read https://raw.githubusercontent.com/anandgupta42/receipts/main/README.md
and follow the "Instructions for agents" section: install aireceipts globally
and set up the Claude Code statusline.
```

El agente maneja la instalación de npm y la edición de la configuración, y te muestra un recibo cuando termina.

#### Instrucciones para agentes

Si eres un agente de IA solicitado a instalar aireceipts, haz lo siguiente:

1. **Instala el CLI globalmente.** Ejecuta `npm install -g aireceipts-cli`, luego confirma con `aireceipts --version`. Si no se permiten instalaciones globales en esta máquina, retrocede a `npx aireceipts-cli` en los pasos a continuación y dile al usuario por qué.

2. **Configura la statusline de Claude Code** (omite si Claude Code no está instalado, y dilo). Agrega una entrada `statusLine` a `~/.claude/settings.json`:

   ```json
   {
     "statusLine": {
       "type": "command",
       "command": "aireceipts statusline"
     }
   }
   ```

   Fusiona en el JSON existente; no sobrescribas otras configuraciones. Si ya existe una entrada `statusLine`, muéstrasela al usuario y pregunta antes de reemplazarla. Si `aireceipts` no está en el `PATH` que ven las aplicaciones lanzadas por GUI, usa la ruta absoluta de `which aireceipts` como valor de `command`.

3. **Verifica.** Ejecuta `aireceipts` para imprimir un recibo de la sesión más nueva (`aireceipts --demo` si el usuario no tiene ninguna aún) y `aireceipts setup` para agentes detectados. La statusline aparece en el siguiente prompt de Claude Code.

4. **Muestra el resultado al usuario.** Imprime el recibo y dile que la statusline está activa. Pasos siguientes opcionales: `aireceipts install-hook` (mini-recibo al final de la sesión con puerta de consentimiento) y `aireceipts integrations` (fragmentos para Codex, OpenCode, Cursor y recibos de PR de GitHub).

## Todo lo demás que hace

| Comando | Qué hace |
|---|---|
| `aireceipts` | Recibo de la sesión más nueva (`--list` para elegir otra) |
| `aireceipts --mini` | Mini-recibo de seis líneas para la sesión más nueva |
| `aireceipts --details` | Agrega una sección DETAILS: composición de tokens, forma de la sesión, división por modelo (plantilla clásica) |
| `aireceipts --template <name>` / `templates` | Renderiza un estilo de recibo (`classic`, `grocery`, `datavis`); `templates` previsualiza cada uno — [guía](docs/guide/10-templates.md) |
| `aireceipts setup` | Sesiones encontradas, último suelo observable, suelo semanal y las integraciones que se ajustan a tu máquina — [guía](docs/guide/01-getting-started.md) |
| `aireceipts pr --post [--artifact]` | Adjunta el recibo de las sesiones detrás de una PR como un comentario; `--artifact` también publica una página de recibo duradera — [guía](docs/pr-receipts.md) |
| `aireceipts compare <a> <b>` | Dos sesiones lado a lado: modelos, herramientas, patrones señalados, ratio cuando la cobertura es completa — [guía](docs/guide/05-compare.md) |
| `aireceipts week` | Resumen de los últimos 7 días: totales, división por agente, patrones señalados — [guía](docs/guide/06-week.md) |
| `aireceipts backfill [--out <dir>]` | Recibos masivos a lo largo de tu historial de sesiones existente; resumen por defecto, un archivo por sesión con `--out` — [guía](docs/guide/01-getting-started.md) |
| `aireceipts integrations [target]` | Fragmentos locales exactos para Claude Code, Codex, OpenCode, Cursor y GitHub — [guía](docs/guide/15-integrations.md) |
| `aireceipts --handoff` | Bloque listo para pegar que le dice a tu *agente* qué hacer más barato la próxima vez — [guía](docs/guide/09-handoff.md) |
| `aireceipts install-hook` | Gancho de Claude Code con puerta de consentimiento: cada sesión termina con un mini-recibo — [guía](docs/guide/03-install-hook.md) |
| `aireceipts statusline` | Línea de suelo observable en vivo en la barra de estado de Claude Code, o cualquier terminal vía `--cwd` (tmux/starship/pwsh) — [configuración](docs/statusline.md) |
| `aireceipts --quota` / `--check-budget` | Ventana de límite de tasa de Claude Code, leída desde la carga útil de stdin de la statusline (silencioso en otro caso); `--check-budget` sale con 1 cuando se excede tu límite de presupuesto local |
| `aireceipts --json` / `--csv` / `--svg` / `--png` | Esquema con versión, filas RFC 4180, imagen SVG/PNG compartible — [esquema](docs/json-schema.md) |
| `aireceipts stats` | Contadores de uso local: recibos generados en esta máquina |

<div align="center">

<img alt="Historical terminal recording of a synthetic handoff. Current aireceipts prints FLAGGED PATTERN COST with approximate notation, a not-proven-savings disclaimer, the flagged Bash loop evidence and its fix, and the coverage line; this recording predates that notation." src="site/assets/waste-handoff.gif" width="640">

</div>

## Las reglas de honestidad

Cada dólar mostrado usa una fila citada (URL del proveedor, fecha observada, extracto — verificado por CI). Los recibos son deterministas y validados con resultados de referencia (golden). No tener una fila de modelo coincidente significa solo tokens; las lecturas/escrituras en caché sin una tarifa aplicable citada contribuyen cero con una advertencia. Codex soporta aritmética de suelo de la API estándar a nivel de solicitud determinista, no una factura exacta: las trazas omiten escrituras de caché, ruta de facturación/autenticación, IDs de solicitud/factura, descuentos y créditos. Las comparaciones reprecian tokens idénticos; nunca predicen. Qué prueba un recibo, y qué no puede: [docs/trust.md](docs/trust.md) · `aireceipts --methodology`.


## Telemetría

Diagnósticos y señales de uso anónimos, activados por defecto (también en CI) — clases de error, contenedores de duración, firmas de fallo de análisis, enums de características y contenedores gruesos. Nunca código, prompts, rutas, títulos o cantidades en dólares. Ve exactamente lo que una ejecución enviaría: `aireceipts --telemetry-show`. Desealo: `AIRECEIPTS_TELEMETRY=off` o `DO_NOT_TRACK=1`. Esquema y razonamiento: [docs/telemetry.md](docs/telemetry.md).

## Documentación

**[Guía de usuario](docs/guide/01-getting-started.md)** — para empezar, cada comando, precios, solución de problemas ([documentación alojada](https://anandgupta42.github.io/receipts/docs/) · [sitio](https://anandgupta42.github.io/receipts/)). También: [FAQ](docs/faq.md) · [Qué prueba un recibo](docs/trust.md) · [Recibos de PR](docs/pr-receipts.md) · [Esquema JSON](docs/json-schema.md) · [statusline](docs/statusline.md).


## Versionado y contribuciones

Pre-1.0 (`0.x`): las versiones **menores** pueden cambiar el comportamiento o la salida, las versiones de **parche** son solo correcciones. El contrato de estabilidad de bytes del recibo es la superficie de compatibilidad: un cambio que lo rompa es un salto **mayor** ([registro de cambios](docs/CHANGELOG.md) · [lanzamientos](https://github.com/anandgupta42/receipts/releases)). aireceipts es diseñado y mayormente construido por agentes de IA bajo un arnés impulsado por especificaciones — especificaciones validadas adversariamente, rutas monetarias probadas por mutación, salidas de bytes de referencia y PRs que llevan el recibo de la sesión que las construyó ([cómo y por qué](docs/internal/harness.md)). Las PRs humanas son bienvenidas y pasan por las mismas puertas: [CONTRIBUTING.md](CONTRIBUTING.md).

## Licencia

Apache-2.0.

## Cómprame un samosa

Cada proyecto de código abierto te pide que le compres un café al mantenedor. Este no — [cómprame un samosa](https://anandgupta42.github.io/receipts/samosa.html), y te explicaré.
