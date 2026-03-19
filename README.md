![screenshot](./docs/screensht.png)

---

# Robot Viewer

[![Version](https://img.shields.io/badge/version-v1.2.0-blue.svg)](https://github.com/fan-ziqi/robot_viewer)
[![License](https://img.shields.io/badge/license-Apache--2.0-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-web-orange.svg)](https://github.com/fan-ziqi/robot_viewer)
[![JavaScript](https://img.shields.io/badge/language-JavaScript-f1e05a.svg)](https://github.com/fan-ziqi/robot_viewer)
[![Three.js](https://img.shields.io/badge/Three.js-0.163.0-black.svg)](https://threejs.org/)
[![Vite](https://img.shields.io/badge/Vite-4.5.0-646cff.svg)](https://vitejs.dev/)
[![Demo](https://img.shields.io/badge/Demo-Live-brightgreen.svg)](http://viewer.robotsfan.com/)

**Robot Viewer** is a web-based 3D viewer for robot models and scenes. Built on top of [Three.js](https://threejs.org/), it provides an intuitive interface for visualizing, editing, and simulating robots directly in the browser without any installation required. This tool helps you visualize and analyze robot structures, joints, and physical properties.

**Live Demo** (All processing happens in your browser - your models never leave your device):

[![Try it now](https://img.shields.io/badge/🌐_Try_it_now-viewer.robotsfan.com-brightgreen?style=for-the-badge)](http://viewer.robotsfan.com/)

## Key Features

- **Format Support**:
  - **URDF**: Unified Robot Description Format
  - **Xacro**: ROS Xacro format with macro expansion and conditional logic support
  - **MJCF**: Mujoco XML format
  - **USD**: Universal Scene Description (partial support)
- **Robot Types**: Serial robot structures (parallel robots not currently supported)
- **Visualization Tools**: Visual/collision geometry, inertia tensors, center of mass, coordinate frames, joint axes, shadows, coordinate system orientation
- **Interactive Controls**: Drag joints in real-time, adjust model poses
- **Measurement Tools**: Measure distances between joints and links with 3D visualization, display X/Y/Z axis projections and total distance, support ground height measurement
- **Diagnostics Workflow**: Structured model and runtime diagnostics with health states, missing resource detection, and UI linkage across the panel, graph, joint controls, and editor
- **Review Snapshots**: Export review context as JSON, including comments, selection, camera state, joint state, and diagnostics state
- **Code Editor**: Built-in CodeMirror editor with syntax highlighting and live preview
- **Physics Simulation**: Integrated MuJoCo engine for dynamics simulation (MJCF models)
- **Scene Management**: File tree and scene graph visualization with hierarchical structure

## Getting Started

This project uses **pnpm**, but you can also use **npm** or **yarn**.

Clone the repository and install dependencies:

```bash
git clone https://github.com/fan-ziqi/robot_viewer.git
cd robot_viewer
pnpm install
```

Start the development server:

```bash
pnpm run dev
```

Build for production:

```bash
pnpm run build
```

Output will be in the `dist/` directory.

## Diagnostics and Review

Robot Viewer includes a debugger-oriented diagnostics workflow for URDF and Xacro models, helping you understand why a model is incomplete, degraded, or only partially loadable after import.

- **Diagnostics Panel**: Inspect model and runtime diagnostics in one place, including severity summary chips, missing resource candidates, and quick navigation to related links, joints, or editor locations
- **Resource Tracking**: Missing visual meshes, collision meshes, textures, and Xacro include failures are tracked during resource resolution with best-effort source context
- **Health State**: Models surface a high-level state of `healthy`, `degraded`, `broken`, or `unloadable`
- **Top-Level Alerts**: Major integrity issues can also appear in a banner so critical problems are not buried in the panel

Robot Viewer also supports review snapshot export for sharing inspection context. A snapshot can capture:

- model metadata such as file path, file name, and file type
- review comments anchored to links, joints, or diagnostics
- camera state, current selection, joint state, and diagnostics panel filters or focus

For the full snapshot schema, see [`docs/review-snapshot-schema.md`](./docs/review-snapshot-schema.md). For more details on the diagnostics design and behavior, see [`docs/diagnostics-log.md`](./docs/diagnostics-log.md).

## Diagnostics Fixtures

For diagnostics-related development, the repository includes a fixed fixture set for regression checking. These fixtures help validate missing resources, Xacro include failures, source mapping behavior, severity handling, and model health calculation.

When the app is running in development mode, fixture helpers are exposed on `window.app`:

```js
window.app.listDiagnosticsFixtures()
window.app.loadDiagnosticsFixture(id)
window.app.runDiagnosticsFixture(id)
window.app.runAllDiagnosticsFixtures()
```

Fixture assets live under `public/diagnostics-fixtures/`. The full fixture list, workflow, and expected result structure are documented in [`docs/diagnostics-fixtures.md`](./docs/diagnostics-fixtures.md).

## Contributing

We welcome contributions from the community! Whether you're fixing bugs, adding features, or improving documentation, your help is appreciated.

- **Bug Reports**: Open an [issue](https://github.com/fan-ziqi/robot_viewer/issues) with details
- **Feature Requests**: Discuss ideas in [Discussions](https://github.com/fan-ziqi/robot_viewer/discussions)
- **Pull Requests**: Submit PRs with clear descriptions and tests

## License

This project is licensed under the [Apache License 2.0](LICENSE).

## Acknowledgements

Robot Viewer builds upon the excellent work of the open-source robotics community. This project integrates several powerful open-source projects:

- **[urdf-loader](https://github.com/gkjohnson/urdf-loaders)** - Robust URDF loading for Three.js
- **[xacro-parser](https://github.com/gkjohnson/xacro-parser)** - ROS Xacro file format parser for Javascript
- **[mujoco_wasm](https://github.com/zalo/mujoco_wasm)** - MuJoCo physics engine compiled to WebAssembly
- **[usd-viewer](https://github.com/needle-tools/usd-viewer)** - OpenUSD viewer with rich USDStage support
- **[mechaverse](https://github.com/jurmy24/mechaverse)** - Universal 3D viewer for robot models, providing valuable design inspiration

Special thanks to all the maintainers and contributors of these projects for their foundational work.

Parts of this project were developed with the assistance of [Cursor](https://cursor.sh).
