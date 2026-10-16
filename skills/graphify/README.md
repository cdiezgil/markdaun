# Skill: Graphify

Skill de análisis de código para el **Agente Analista**. Permite mapear el impacto técnico de una feature recorriendo el grafo de dependencias del codebase, sin explorar ficheros a ciegas.

## Instalación

```bash
npm install -g graphify-pi
```

Reinicia pi para que detecte la skill automáticamente.

## SKILL.md

El fichero `SKILL.md` de esta carpeta es la **referencia de la skill** tal como la usa pi. Lo carga automáticamente cuando el agente hace una consulta que coincide con la descripción de la skill.

## Uso básico (el Analista lo ejecuta directamente en shell)

```bash
# Construir / refrescar el grafo del proyecto
graphify update <directorio-raiz>

# Buscar nodos relevantes para una feature
graphify query "descripción funcional de la feature" --graph <dir>/graphify-out/graph.json

# Explicar un nodo (dependencias, quién depende de él)
graphify explain "<NombreNodo>" --graph <dir>/graphify-out/graph.json

# Trazar camino entre dos nodos (p.ej. componente React → endpoint API)
graphify path "<NodoA>" "<NodoB>" --graph <dir>/graphify-out/graph.json

# Ver impacto inverso (quién se rompe si modifico este nodo)
graphify affected "<NodoA>" --graph <dir>/graphify-out/graph.json
```

## Notas

- El grafo es **monolítico**: se construye en la raíz que agrupa todos los repos del proyecto y captura relaciones entre ellos (React ↔ BFF ↔ API).
- Pasa siempre `--graph <pool-dir>/graphify-out/graph.json` a los comandos que lo aceptan.
- Si el grafo está desactualizado (ficheros cambiaron desde el último build), ejecuta `graphify update` antes de consultar.
