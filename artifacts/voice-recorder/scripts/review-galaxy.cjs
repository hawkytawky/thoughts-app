// Render the actual GalaxyGraph worklet with Skia/CanvasKit, without React or a browser.
// Usage: node scripts/review-galaxy.cjs [output-directory]
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const ts = require("typescript");
const app = path.resolve(__dirname, "..");
const skiaRoot = path.dirname(
  require.resolve("@shopify/react-native-skia/package.json"),
);
const kitPath = require.resolve("canvaskit-wasm/bin/full/canvaskit.js", {
  paths: [skiaRoot],
});
const { JsiSkApi } = require(
  path.join(skiaRoot, "lib/commonjs/skia/web/JsiSkia.js"),
);
const { JsiSkCanvas } = require(
  path.join(skiaRoot, "lib/commonjs/skia/web/JsiSkCanvas.js"),
);
const source = fs.readFileSync(
  path.join(app, "components/overview/GalaxyGraph.tsx"),
  "utf8",
);
const ast = ts.createSourceFile(
  "GalaxyGraph.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let render;
let tapHandler;
let fitEffect;
function visit(node) {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(ast) === "useEffect" &&
    node.arguments[0]?.getText(ast).includes("fittedPeriodRef.current = period")
  )
    fitEffect = node.arguments[0].getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "handleTap")
    tapHandler = node.initializer.arguments[0].getText(ast);
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "picture") {
    render = node.initializer.arguments[0].body.arguments[0].getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert(render, "Actual rendering worklet must be found");
const pure = source.slice(
  source.indexOf("const W ="),
  source.indexOf("function nodeDateKey("),
);
const transpile = (code) =>
  ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
const reviewNow = Date.parse("2026-09-11T12:00:00Z");
class ReviewDate extends Date {
  constructor(...args) {
    super(...(args.length ? args : [reviewNow]));
  }
  static now() {
    return reviewNow;
  }
}
const palette = [
  "#5266B3",
  "#D37D74",
  "#539D87",
  "#A288C1",
  "#C5994F",
  "#5D92A8",
  "#B06F8E",
  "#7E9362",
  "#C27B55",
  "#6F82A6",
];
const titles = [
  "Beruf & Zukunft",
  "Beziehungen",
  "Alltag",
  "thoughts",
  "Persönlichkeitsentwicklung",
  "Lernen",
  "Selbstwert",
  "Gewohnheiten",
  "Kreativität",
  "Fitness",
];
const screenWidth = 369;
const screenHeight = 800;
const headerHeight = 134;
// Explicit synthetic fixture; no user data or backend credentials are loaded.
const graph = {
  meta: {
    nodes: 0,
    clusters: 10,
    sourceCount: 0,
    assignedCount: 0,
    pendingThoughts: 8,
    themeThreshold: 5,
    medianWordCount: 70,
    medianDurationSeconds: 30,
  },
  clusters: palette.map((color, i) => ({
    id: `topic-${i}`,
    label: titles[i],
    color,
    description: "",
    status: "active",
    count: [56, 18, 22, 9, 16, 12, 20, 2, 12, 7][i],
    anchorX: 0,
    anchorY: 0,
  })),
  nodes: [],
  edges: [],
  topicSimilarities: [],
  secondaryTopicEdges: [],
};
for (const [themeIndex, cluster] of graph.clusters.entries()) {
  for (let j = 0; j < cluster.count; j++) {
    const angle = j * 2.399963 + themeIndex * 0.4;
    const r = 0.2 + 1.35 * Math.sqrt((j + 0.5) / cluster.count);
    const idx = graph.nodes.length;
    graph.nodes.push({
      id: `${cluster.id}-${j}`,
      idx,
      cluster: cluster.id,
      x: Math.cos(angle) * r,
      y: Math.sin(angle) * r * 0.8,
      z: Math.sin(j * 1.73) * 0.5,
      wordCount: [12, 30, 70, 140, 280, 560][j % 6],
      durationSeconds: [5, 15, 30, 60, 120, 240][j % 6],
      capturedAt: new Date(
        reviewNow -
          [0, 7, 30, 60, 90, 180][(j * 5 + themeIndex) % 6] * 86400000,
      ).toISOString(),
      date: "2026-09-11",
      keyword: `Gedanke ${j + 1}`,
      title: `Gedanke ${j + 1}`,
    });
  }
}
graph.meta.nodes =
  graph.meta.sourceCount =
  graph.meta.assignedCount =
    graph.nodes.length;
(async () => {
  const kit = await require(kitPath)({
    locateFile: (file) => path.join(path.dirname(kitPath), file),
  });
  const Skia = JsiSkApi(kit);
  const fontRoot = path.dirname(
    require.resolve("@expo-google-fonts/instrument-sans/package.json"),
  );
  const fontBytes = fs.readFileSync(
    path.join(fontRoot, "400Regular/InstrumentSans_400Regular.ttf"),
  );
  const face = Skia.Typeface.MakeFreeTypeFaceFromData(
    Skia.Data.fromBytes(fontBytes),
  );
  const serifRoot = path.dirname(
    require.resolve("@expo-google-fonts/newsreader/package.json"),
  );
  const serifFace = Skia.Typeface.MakeFreeTypeFaceFromData(
    Skia.Data.fromBytes(
      fs.readFileSync(
        path.join(serifRoot, "400Regular/Newsreader_400Regular.ttf"),
      ),
    ),
  );
  const themeFont = Skia.Font(face, 11);
  const context = {
    Math,
    Date: ReviewDate,
    console,
    Skia,
    BlendMode: { DstIn: 6, Screen: 14 },
    PaintStyle: { Stroke: 1 },
    TileMode: { Clamp: 0 },
    Easing: { bezier: () => null },
    MEMORY_THEME: { field: "#F2F3F5", ink: "#243542" },
    graph,
    size: { width: screenWidth, height: screenHeight - headerHeight },
    themeFont,
    thoughtFont: Skia.Font(face, 9),
    period: "all",
    cameraX: { value: 180.5 },
    cameraY: { value: 280 },
    cameraZ: { value: 0 },
    zoom: { value: 1 },
    yaw: { value: 0 },
    pitch: { value: 0.06 },
    drill: { value: 0 },
    selectedThemeIndexSV: { value: -1 },
    selectedThoughtIndexSV: { value: -1 },
    thoughtSelectionProgress: { value: 0 },
    renderingStage: "colors",
  };
  context.globalThis = context;
  Function(
    "context",
    "with (context) {" +
      transpile(
        pure +
          "\nglobalThis.build = buildGalaxyLayout; globalThis.thoughtLight = thoughtLight; globalThis.fitCamera = fitOverviewCamera; globalThis.makeViewport = graphViewport; globalThis.radius = thoughtRadius; globalThis.age = thoughtAgeOpacity; globalThis.dotRadius = projectedDotRadius; globalThis.plane = screenPlaneOffset; globalThis.labelLayout = graphLabelLayout; globalThis.hitLabel = hitThoughtLabel; globalThis.fitLabels = fitThemeLabels; globalThis.labels = projectedThemeLabels; globalThis.world = worldPoint; globalThis.project = projectPoint; globalThis.render = " +
          render +
          "; globalThis.tap = " +
          tapHandler +
          ";globalThis.applyFit = " +
          fitEffect +
          ";",
      ) +
      "}",
  )(context);
  Object.defineProperty(context, "projectedLabels", {
    get: () => ({
      value: context.labelLayout(
        context.layout,
        graph,
        context.thoughtFont,
        context.period,
        {
          x: context.cameraX.value,
          y: context.cameraY.value,
          z: context.cameraZ.value,
          zoom: context.zoom.value,
          yaw: context.yaw.value,
          pitch: context.pitch.value,
          drill: context.drill.value,
          themeIndex: context.selectedThemeIndexSV.value,
          thoughtIndex: context.selectedThoughtIndexSV.value,
        },
        context.thoughtLayoutIndexByNodeIndex,
      ),
    }),
  });
  context.layout = context.fitLabels(context.build(graph, "all"), themeFont);
  context.viewport = context.makeViewport(
    context.size.width,
    context.size.height,
    104,
  );
  const fitted = context.fitCamera(context.layout);
  context.cameraX.value = fitted.x;
  context.cameraY.value = fitted.y;
  context.cameraZ.value = fitted.z;
  context.zoom.value = fitted.zoom;
  context.thoughtLayoutIndexByNodeIndex = graph.nodes.map((_, index) => index);
  assert.deepEqual(
    Array.from(context.layout.themes, (theme) => theme.sourceColor),
    palette,
    "Stored colors must pass through unchanged",
  );
  const custom = {
    ...graph,
    clusters: graph.clusters.map((cluster, i) => ({
      ...cluster,
      color: i === 0 ? "#112233" : cluster.color,
    })),
  };
  assert.equal(
    context.build(custom, "all").themes[0].sourceColor,
    "#112233",
    "Color changes invalidate cached materials",
  );
  const output = path.resolve(
    process.argv[2] || path.join(app, "docs/graph-review-v3"),
  );
  fs.mkdirSync(output, { recursive: true });
  const angles = [
    { name: "front", yaw: 0, pitch: 0.06 },
    { name: "left", yaw: -0.65, pitch: 0.25 },
    { name: "right", yaw: 0.65, pitch: -0.2 },
  ];
  const report = [];
  for (const [stageIndex, stage] of ["colors", "matte", "glow"].entries()) {
    for (const angle of angles) {
      context.renderingStage = stage;
      context.yaw.value = angle.yaw;
      context.pitch.value = angle.pitch;
      const surface = kit.MakeSurface(screenWidth * 2, screenHeight * 2);
      const canvas = new JsiSkCanvas(kit, surface.getCanvas());
      canvas.drawColor(Skia.Color("#F2F3F5"));
      canvas.scale(2, 2);
      const paint = Skia.Paint();
      paint.setColor(Skia.Color("#243542"));
      canvas.drawText("thoughts", 22, 78, paint, Skia.Font(serifFace, 23));
      canvas.drawText(
        "Gesamt",
        screenWidth - 94,
        78,
        paint,
        Skia.Font(face, 14),
      );
      canvas.drawText(
        "base     network     feeling",
        22,
        121,
        paint,
        Skia.Font(face, 15),
      );
      const tabPaint = Skia.Paint();
      tabPaint.setColor(Skia.Color("#F9FAFC"));
      canvas.drawRRect(
        Skia.RRectXY(
          Skia.XYWHRect(10, screenHeight - 84, screenWidth - 20, 58),
          24,
          24,
        ),
        tabPaint,
      );
      const tabFont = Skia.Font(face, 9);
      for (const [label, x] of [
        ["heute", 42],
        ["memory", 109],
        ["community", 253],
        ["account", 324],
      ])
        canvas.drawText(
          label,
          x - tabFont.getTextWidth(label) / 2,
          screenHeight - 44,
          paint,
          tabFont,
        );
      canvas.drawCircle(screenWidth / 2, screenHeight - 69, 29, paint);
      const micPaint = Skia.Paint();
      micPaint.setColor(Skia.Color("#FFFFFF"));
      micPaint.setStyle(1);
      micPaint.setStrokeWidth(1.6);
      canvas.drawRRect(
        Skia.RRectXY(
          Skia.XYWHRect(screenWidth / 2 - 3, screenHeight - 77, 6, 12),
          3,
          3,
        ),
        micPaint,
      );
      canvas.drawLine(
        screenWidth / 2,
        screenHeight - 65,
        screenWidth / 2,
        screenHeight - 59,
        micPaint,
      );
      canvas.drawLine(
        screenWidth / 2 - 4,
        screenHeight - 59,
        screenWidth / 2 + 4,
        screenHeight - 59,
        micPaint,
      );
      canvas.save();
      canvas.translate(0, headerHeight);
      context.render(canvas);
      canvas.restore();
      surface.flush();
      const image = surface.makeImageSnapshot();
      fs.writeFileSync(
        path.join(output, `${stageIndex + 1}-${stage}-${angle.name}.png`),
        image.encodeToBytes(),
      );
      const pixels = image.readPixels(0, 0, {
        width: screenWidth * 2,
        height: screenHeight * 2,
        colorType: kit.ColorType.RGBA_8888,
        alphaType: kit.AlphaType.Unpremul,
        colorSpace: kit.ColorSpace.SRGB,
      });
      for (const y of [
        headerHeight * 2,
        headerHeight * 2 + 1,
        (screenHeight - 1) * 2,
      ]) {
        for (let x = 0; x < screenWidth * 2; x++) {
          const at = (y * screenWidth * 2 + x) * 4;
          assert.deepEqual(
            Array.from(pixels.slice(at, at + 3)),
            [242, 243, 245],
            `${stage}/${angle.name}: render boundary must match native background`,
          );
        }
      }
      const labels = context.labels(
        context.layout.themes,
        context.layout.thoughts,
        fitted.x,
        fitted.y,
        fitted.z,
        fitted.zoom,
        angle.yaw,
        angle.pitch,
      );
      report.push({
        stage,
        angle: angle.name,
        labels: Array.from(
          labels,
          (label) => context.layout.themes[label.themeIndex].label,
        ),
      });
      image.delete();
      surface.delete();
    }
    const sheet = kit.MakeSurface(screenWidth * 3, screenHeight + 40);
    const sheetCanvas = sheet.getCanvas();
    sheetCanvas.clear(kit.Color(242, 243, 245, 1));
    const labelPaint = new kit.Paint();
    labelPaint.setColor(kit.Color(36, 53, 66, 1));
    const labelFont = new kit.Font(face.ref, 14);
    for (const [column, angle] of angles.entries()) {
      sheetCanvas.drawText(
        `${stageIndex + 1}. ${stage} · ${angle.name} (${Math.round((angle.yaw * 180) / Math.PI)}°)`,
        column * screenWidth + 22,
        25,
        labelPaint,
        labelFont,
      );
      const frame = kit.MakeImageFromEncoded(
        fs.readFileSync(
          path.join(output, `${stageIndex + 1}-${stage}-${angle.name}.png`),
        ),
      );
      sheetCanvas.save();
      sheetCanvas.translate(column * screenWidth, 40);
      sheetCanvas.scale(0.5, 0.5);
      sheetCanvas.drawImage(frame, 0, 0);
      sheetCanvas.restore();
      frame.delete();
    }
    sheet.flush();
    const snapshot = sheet.makeImageSnapshot();
    fs.writeFileSync(
      path.join(output, `${stageIndex + 1}-${stage}-angles.png`),
      snapshot.encodeToBytes(),
    );
    snapshot.delete();
    labelFont.delete();
    labelPaint.delete();
    sheet.delete();
  }
  // Validate placement over more camera angles and zoom levels than the contact sheet.
  let labelCount = 0;
  for (const yaw of [-1.2, -0.65, 0, 0.65, 1.2])
    for (const pitch of [-0.8, 0.06, 0.8])
      for (const zoom of [0.7, 1, 2, 4]) {
        const labels = context.labels(
          context.layout.themes,
          context.layout.thoughts,
          180.5,
          280,
          0,
          zoom,
          yaw,
          pitch,
        );
        const points = context.layout.thoughts.map((thought) => {
          const w = context.world(
            thought,
            context.layout.themes[thought.themeIndex],
            0,
          );
          const p = context.project(
            w.x,
            w.y,
            w.z,
            180.5,
            280,
            0,
            zoom,
            yaw,
            pitch,
            0,
          );
          return {
            ...p,
            themeIndex: thought.themeIndex,
            radius: context.dotRadius(thought.size, p.magnification),
          };
        });
        for (const label of labels) {
          labelCount++;
          const distances = points.map((p) => ({
            themeIndex: p.themeIndex,
            distance:
              Math.hypot(
                Math.max(
                  label.x - label.width / 2 - p.x,
                  0,
                  p.x - label.x - label.width / 2,
                ),
                Math.max(
                  label.y - label.height / 2 - p.y,
                  0,
                  p.y - label.y - label.height / 2,
                ),
              ) - p.radius,
          }));
          const own = Math.min(
            ...distances
              .filter((d) => d.themeIndex === label.themeIndex)
              .map((d) => d.distance),
          );
          const foreign = Math.min(
            ...distances
              .filter((d) => d.themeIndex !== label.themeIndex)
              .map((d) => d.distance),
          );
          assert(
            own >= 4 && own <= 12 && foreign >= own + 6,
            "Visible label must clearly belong to its own cluster and avoid every dot",
          );
        }
      }
  assert(labelCount > 0, "Placement must not simply hide every label");
  // Check the temporal and importance encodings separately from camera depth.
  const ageValues = [0, 45, 90, 180].map((days) =>
    context.age({
      capturedAt: new Date(reviewNow - days * 86400000).toISOString(),
    }),
  );
  assert(ageValues.every((value, i) => i === 0 || value < ageValues[i - 1]));
  assert(
    ageValues[0] - ageValues[3] > 0.6,
    "Age must remain visually meaningful",
  );
  const sizeValues = [0.2, 1, 4].map((ratio) =>
    context.radius(
      { wordCount: 70 * ratio, durationSeconds: 30 * ratio },
      graph,
    ),
  );
  assert(
    sizeValues[2] / sizeValues[0] > 2,
    "Long recordings should have materially more area",
  );
  assert.equal(
    context.radius({ wordCount: 70, durationSeconds: null }, graph),
    sizeValues[1],
  );
  assert.equal(
    context.radius({ wordCount: 0, durationSeconds: 30 }, graph),
    sizeValues[1],
  );
  assert.equal(
    context.radius({ wordCount: 0, durationSeconds: null }, graph),
    4.4,
  );
  assert(
    context.radius({ wordCount: 700000, durationSeconds: 300000 }, graph) <=
      7.2,
  );
  assert.equal(
    context.radius({ wordCount: 140, durationSeconds: 0 }, graph),
    context.radius({ wordCount: 0, durationSeconds: 60 }, graph),
    "Words and duration carry equal weight",
  );

  let checkedLabelTaps = 0;
  let previewed = -1;
  context.openThoughtPreview = (index) => {
    previewed = index;
  };
  context.focusTheme = () => {};
  for (const themeIndex of [-1, 0, 2])
    for (const yaw of [-0.65, 0, 0.65])
      for (const zoom of [1, 2.8, 4]) {
        const theme = context.layout.themes[themeIndex];
        const camera = {
          x: theme?.cx ?? 180.5,
          y: theme?.cy ?? 280,
          z: theme?.cz ?? 0,
          yaw,
          pitch: 0.1,
          zoom,
          drill: theme ? 1 : 0,
          themeIndex,
          thoughtIndex: -1,
        };
        const result = context.labelLayout(
          context.layout,
          graph,
          context.thoughtFont,
          "all",
          camera,
          context.thoughtLayoutIndexByNodeIndex,
        );
        for (const label of result.thoughts.filter(
          (label) => label.alpha >= 0.12,
        )) {
          const x = label.x + label.width / 2;
          const y = label.y - 3;
          const hit = context.hitLabel(result.thoughts, x, y);
          assert.equal(
            hit,
            label.nodeIndex,
            "Hit must resolve to the actually drawn label",
          );
          previewed = -1;
          context.tap(
            x,
            y,
            camera.x,
            camera.y,
            camera.z,
            zoom,
            yaw,
            camera.pitch,
            camera.drill,
            themeIndex,
            hit,
          );
          assert.equal(
            previewed,
            label.nodeIndex,
            "Actual tap handler must select the corresponding thought",
          );
          checkedLabelTaps++;
        }
        assert.equal(
          context.hitLabel(result.thoughts, -50, -50),
          -1,
          "Empty space is not a label hit",
        );
      }
  assert(
    checkedLabelTaps > 10,
    "Exercise focused and overview labels at multiple angles",
  );
  assert.equal(
    context.hitLabel(
      [{ nodeIndex: 123, x: 20, y: 20, width: 50, height: 13, alpha: 0.01 }],
      30,
      17,
    ),
    -1,
    "Invisible labels cannot intercept touches",
  );
  let checkedAnchors = 0;
  for (const yaw of [-0.8, 0, 0.8])
    for (const pitch of [-0.6, 0.2, 0.6]) {
      const center = { x: 180.5, y: 280, z: 30 };
      const start = context.plane(60, -35, yaw, pitch);
      const anchor = {
        x: center.x + start.x,
        y: center.y + start.y,
        z: center.z + start.z,
      };
      const offset = context.plane(60 / 2.3, -35 / 2.3, yaw, pitch);
      const projected = context.project(
        anchor.x,
        anchor.y,
        anchor.z,
        anchor.x - offset.x,
        anchor.y - offset.y,
        anchor.z - offset.z,
        2.3,
        yaw,
        pitch,
        0,
      );
      assert(
        Math.abs(projected.x - 240.5) < 0.001 &&
          Math.abs(projected.y - 245) < 0.001,
        "Pinch focal anchor must survive yaw, pitch and zoom",
      );
      checkedAnchors++;
    }
  // Execute the production gesture callbacks with deterministic shared values.
  const animations = [];
  let interruptions = 0;
  const gesture = () => {
    const callbacks = {};
    const chain = {};
    for (const name of ["maxPointers", "minDistance"])
      chain[name] = () => chain;
    for (const name of [
      "onBegin",
      "onStart",
      "onUpdate",
      "onEnd",
      "onFinalize",
    ])
      chain[name] = (fn) => {
        callbacks[name] = fn;
        return chain;
      };
    chain.callbacks = callbacks;
    return chain;
  };
  Object.assign(context, {
    Gesture: { Pan: gesture, Pinch: gesture },
    scaleX: 1,
    scaleY: 1,
    reduceMotion: false,
    panOrigin: { value: {} },
    viewport: { scale: 1, x: 0, y: 0 },
    pinchActive: { value: false },
    pinchStartZoom: { value: 1 },
    pinchAnchor: { value: {} },
    cancelAnimation: () => {
      interruptions++;
    },
    withTiming: (target, options) => {
      animations.push(options);
      return target;
    },
    Easing: { bezier: () => null, out: () => null, cubic: () => null },
  });
  const gestureCode = source.slice(
    source.indexOf("  const stopCameraMotion ="),
    source.indexOf("  const projectedLabels = useDerivedValue"),
  );
  Function(
    "context",
    "with(context){" +
      transpile(pure + gestureCode + "\nglobalThis.gestures = {pan, pinch};") +
      "}",
  )(context);
  const pan = context.gestures.pan.callbacks;
  const pinch = context.gestures.pinch.callbacks;
  const reset = () => {
    context.cameraX.value = 180.5;
    context.cameraY.value = 280;
    context.cameraZ.value = 0;
    context.zoom.value = 1;
    context.yaw.value = 0;
    context.pitch.value = 0.06;
    context.drill.value = 0;
    context.pinchActive.value = false;
    animations.length = 0;
  };
  reset();
  pinch.onFinalize();
  assert.equal(
    animations.length,
    0,
    "A failed pinch must not animate a simple tap",
  );
  pan.onStart({ translationX: 9, translationY: 0 });
  pan.onUpdate({ translationX: 9, translationY: 0 });
  assert.equal(
    context.yaw.value,
    0,
    "Activation threshold must not cause a rotation jump",
  );
  pan.onUpdate({ translationX: 109, translationY: 0 });
  assert(Math.abs(context.yaw.value - 0.55) < 0.0001);
  const previousYaw = context.yaw.value;
  pan.onEnd({ velocityX: 5000, velocityY: 0 }, true);
  assert(
    context.yaw.value - previousYaw <= 0.220001,
    "Fling rotation must be tightly capped",
  );
  assert(
    animations.every((animation) => animation.duration <= 180),
    "Gesture tails should settle briefly",
  );
  assert(
    interruptions >= 6,
    "Starting a gesture must interrupt camera animations",
  );
  reset();
  pan.onBegin();
  pan.onStart({ translationX: 4, translationY: 0 });
  pan.onUpdate({ translationX: 24, translationY: 0 });
  assert(context.yaw.value > 0.1, "A short drag must visibly rotate the scene");
  assert.equal(
    animations.length,
    0,
    "Finger tracking must not be animated or delayed",
  );
  pan.onEnd({ velocityX: 300, velocityY: 0 }, true);
  assert(
    Math.abs(context.yaw.value - 0.198) < 0.00001,
    "Ordinary releases must continue at the finger speed before easing out",
  );
  reset();
  pan.onStart({ translationX: 0, translationY: 0 });
  pan.onUpdate({ translationX: 0, translationY: 1000 });
  assert.equal(context.pitch.value, 0.9);
  pan.onUpdate({ translationX: 0, translationY: 999 });
  assert(
    context.pitch.value < 0.9,
    "Reversal at a limit must respond on the first pixel",
  );
  pan.onEnd({ velocityX: 1000, velocityY: 1000 }, false);
  assert.equal(animations.length, 0, "Cancelled drags must not coast");
  pan.onEnd({ velocityX: 0, velocityY: 0 }, true);
  assert.equal(animations.length, 0, "A resting finger must stop immediately");
  reset();
  context.reduceMotion = true;
  pan.onStart({ translationX: 0, translationY: 0 });
  pan.onEnd({ velocityX: 5000, velocityY: 3000 }, true);
  assert.equal(animations.length, 0, "Reduced motion disables inertia");
  context.reduceMotion = false;
  for (const zoom of [1, 2.3])
    for (const drill of [0, 1]) {
      reset();
      context.zoom.value = zoom;
      context.drill.value = drill;
      pan.onStart({ translationX: 0, translationY: 0 });
      pan.onUpdate({ translationX: 100, translationY: 0 });
      assert(
        Math.abs(context.yaw.value - 0.55) < 0.0001,
        "One finger must rotate in overview, zoom AND topic focus",
      );
      assert.equal(
        context.cameraX.value,
        180.5,
        "Rotation must not switch to panning in focus",
      );
    }
  reset();
  context.yaw.value = 0.6;
  context.pitch.value = 0.3;
  pinch.onStart({ focalX: 230.5, focalY: 250 });
  const anchor = { ...context.pinchAnchor.value };
  pinch.onUpdate({ focalX: 230.5, focalY: 250, scale: 2 });
  assert.equal(
    context.zoom.value,
    2,
    "Pinch must follow finger spacing proportionally",
  );
  const focal = context.project(
    anchor.x,
    anchor.y,
    anchor.z,
    context.cameraX.value,
    context.cameraY.value,
    context.cameraZ.value,
    context.zoom.value,
    context.yaw.value,
    context.pitch.value,
    0,
  );
  assert(
    Math.abs(focal.x - 230.5) < 0.001 && Math.abs(focal.y - 250) < 0.001,
    "Production pinch callbacks retain the focal anchor",
  );
  const duringPinch = context.yaw.value;
  pan.onUpdate({ translationX: 200, translationY: 100 });
  assert.equal(
    context.yaw.value,
    duringPinch,
    "Pinching must suppress single-finger rotation",
  );
  pinch.onUpdate({ focalX: 230.5, focalY: 250, scale: 1000 });
  assert.equal(context.zoom.value, 5.2);
  pinch.onUpdate({ focalX: 230.5, focalY: 250, scale: 0.001 });
  assert.equal(context.zoom.value, 0.3);
  pinch.onFinalize();
  assert.equal(context.pinchActive.value, false);
  reset();

  // Inspect the exact focused drawing, including dot labels and a selected dot.
  context.viewport = context.makeViewport(
    context.size.width,
    context.size.height,
    104,
  );
  const focused = context.layout.themes[0];
  context.cameraX.value = focused.cx;
  context.cameraY.value = focused.cy;
  context.cameraZ.value = focused.cz;
  context.zoom.value = 1.2;
  context.drill.value = 1;
  context.selectedThemeIndexSV.value = 0;
  context.selectedThoughtIndexSV.value = context.layout.thoughts.findIndex(
    (thought) => thought.themeIndex === 0,
  );
  context.thoughtSelectionProgress.value = 1;
  context.renderingStage = "glow";
  const focusSurface = kit.MakeSurface(
    screenWidth * 2,
    (screenHeight - headerHeight) * 2,
  );
  const focusCanvas = new JsiSkCanvas(kit, focusSurface.getCanvas());
  focusCanvas.drawColor(Skia.Color("#F2F3F5"));
  focusCanvas.scale(2, 2);
  context.render(focusCanvas);
  focusSurface.flush();
  const focusImage = focusSurface.makeImageSnapshot();
  fs.writeFileSync(
    path.join(output, "4-focused-selection.png"),
    focusImage.encodeToBytes(),
  );
  focusImage.delete();
  focusSurface.delete();
  let exitCount = 0;
  context.closeTheme = () => {
    exitCount++;
  };
  for (const selected of [null, 0]) {
    context.selectedThoughtNodeIndex = selected;
    const before = exitCount;
    context.tap(
      12,
      548,
      focused.cx,
      focused.cy,
      focused.cz,
      1,
      0,
      0.06,
      1,
      0,
      -1,
    );
    assert.equal(
      exitCount,
      before + 1,
      "Blank canvas must exit topic even from a thought preview",
    );
  }
  let fittedMarks = 0;
  for (const [width, height] of [
    [320, 434],
    [369, 666],
    [393, 700],
    [430, 766],
  ]) {
    const viewport = context.makeViewport(width, height, 104);
    assert(
      viewport.x >= 0 &&
        viewport.y >= 0 &&
        viewport.x + 361 * viewport.scale <= width &&
        viewport.y + 560 * viewport.scale <= height - 104,
      "The uniform graph frame must fit above navigation",
    );
    for (const angle of angles)
      for (const thought of context.layout.thoughts) {
        const world = context.world(
          thought,
          context.layout.themes[thought.themeIndex],
          0,
        );
        const projected = context.project(
          world.x,
          world.y,
          world.z,
          fitted.x,
          fitted.y,
          fitted.z,
          fitted.zoom,
          angle.yaw,
          angle.pitch,
          0,
        );
        const radius =
          context.dotRadius(thought.size, projected.magnification) *
          viewport.scale;
        const x = viewport.x + projected.x * viewport.scale;
        const y = viewport.y + projected.y * viewport.scale;
        assert(
          x - radius >= 8 &&
            x + radius <= width - 8 &&
            y - radius >= 8 &&
            y + radius <= height - 104,
          "Every initial thought must fit inside the usable viewport, above the tab bar",
        );
        fittedMarks++;
      }
    const physical = {
      x: viewport.x + 120 * viewport.scale,
      y: viewport.y + 200 * viewport.scale,
    };
    assert(
      Math.abs((physical.x - viewport.x) / viewport.scale - 120) < 1e-8 &&
        Math.abs((physical.y - viewport.y) / viewport.scale - 200) < 1e-8,
      "Touch inverse matches rendering",
    );
  }
  // Measure emission in isolation at native 1x resolution, outside the dot.
  // A shader existing in the source is not evidence that its light is visible.
  const originalLayout = context.layout;
  const theme = { ...originalLayout.themes[0], cx: 180.5, cy: 280, cz: 0 };
  context.layout = {
    ...originalLayout,
    themes: [theme],
    thoughts: [
      {
        ...originalLayout.thoughts[0],
        themeIndex: 0,
        rho: 0,
        depth: 0,
        size: 4.4,
        ageOpacity: 0.92,
      },
    ],
    dust: [],
  };
  context.cameraX.value = 180.5;
  context.cameraY.value = 280;
  context.cameraZ.value = 0;
  context.yaw.value = 0;
  context.pitch.value = 0.06;
  context.zoom.value = 1;
  context.drill.value = 0;
  context.selectedThemeIndexSV.value = -1;
  context.selectedThoughtIndexSV.value = -1;
  context.thoughtSelectionProgress.value = 0;
  const frames = {};
  for (const stage of ["colors", "matte", "glow"]) {
    context.renderingStage = stage;
    const surface = kit.MakeSurface(screenWidth, screenHeight - headerHeight);
    const canvas = new JsiSkCanvas(kit, surface.getCanvas());
    canvas.drawColor(Skia.Color("#F2F3F5"));
    context.render(canvas);
    surface.flush();
    const image = surface.makeImageSnapshot();
    frames[stage] = image.readPixels(0, 0, {
      width: screenWidth,
      height: screenHeight - headerHeight,
      colorType: kit.ColorType.RGBA_8888,
      alphaType: kit.AlphaType.Unpremul,
      colorSpace: kit.ColorSpace.SRGB,
    });
    image.delete();
    surface.delete();
  }
  const dotX = context.viewport.x + 180.5 * context.viewport.scale;
  const dotY = context.viewport.y + 280 * context.viewport.scale;
  const dotRadius = context.dotRadius(4.4, 1) * context.viewport.scale;
  let peakBloom = 0;
  let peakAtmosphere = 0;
  let litPixels = 0;
  for (let y = 0; y < screenHeight - headerHeight; y++)
    for (let x = 0; x < screenWidth; x++) {
      const offset = (y * screenWidth + x) * 4;
      const distance = Math.hypot(x + 0.5 - dotX, y + 0.5 - dotY);
      if (distance > dotRadius + 0.5 && distance < dotRadius * 2.4) {
        const increase =
          (frames.glow[offset] -
            frames.matte[offset] +
            frames.glow[offset + 1] -
            frames.matte[offset + 1] +
            frames.glow[offset + 2] -
            frames.matte[offset + 2]) /
          3;
        peakBloom = Math.max(peakBloom, increase);
        if (increase >= 1) litPixels++;
      }
      if (distance > dotRadius * 4)
        peakAtmosphere = Math.max(
          peakAtmosphere,
          frames.colors[offset] - frames.matte[offset],
        );
    }
  console.log({ peakBloom, litPixels, peakAtmosphere });
  assert(
    peakBloom >= 2 && litPixels >= 8,
    "Light must measurably brighten pixels outside the dot at actual phone scale",
  );
  assert(
    peakAtmosphere >= 5,
    "The spatial field must remain perceptible away from the dots",
  );
  // Relative spread and intensity must vary with BOTH size and visible brightness.
  const adaptiveLightCases = [];
  for (const radius of [1.8, 3.2, 5.2]) {
    let previous = null;
    for (const brightness of [0.3, 0.6, 0.92]) {
      const light = context.thoughtLight(radius, 1, brightness, 56);
      if (previous) {
        assert(
          light.glowRadius > previous.glowRadius &&
            light.auraRadius > previous.auraRadius,
        );
        assert(
          light.glowAlpha > previous.glowAlpha &&
            light.auraAlpha > previous.auraAlpha,
        );
      }
      const scaled = context.thoughtLight(radius * 2, 2, brightness, 56);
      assert(Math.abs(scaled.glowRadius - light.glowRadius * 2) < 1e-9);
      assert.equal(
        scaled.glowAlpha,
        light.glowAlpha,
        "Display scaling must not change light strength",
      );
      adaptiveLightCases.push({ radius, brightness, ...light });
      previous = light;
    }
  }
  const smaller = context.thoughtLight(1.8, 1, 0.92, 56);
  const larger = context.thoughtLight(5.2, 1, 0.92, 56);
  assert(
    larger.glowRadius / 5.2 > smaller.glowRadius / 1.8,
    "Large dots need a larger relative spread, not just a fixed radius multiple",
  );
  assert(larger.glowAlpha > smaller.glowAlpha);
  assert.equal(context.thoughtLight(5.2, 1, 0, 56).glowAlpha, 0);

  // Draw the production worklet for all nine combinations, enlarged only for comparison.
  const comparison = kit.MakeSurface(720, 690);
  const comparisonCanvas = comparison.getCanvas();
  comparisonCanvas.clear(kit.Color(242, 243, 245, 1));
  const comparisonPaint = new kit.Paint();
  comparisonPaint.setColor(kit.Color(36, 53, 66, 1));
  const comparisonFont = new kit.Font(face.ref, 14);
  comparisonCanvas.drawText(
    "Schimmer nach Größe und Helligkeit · 3× Detail",
    24,
    28,
    comparisonPaint,
    comparisonFont,
  );
  ["klein", "mittel", "groß"].forEach((text, i) =>
    comparisonCanvas.drawText(
      text,
      165 + i * 200,
      62,
      comparisonPaint,
      comparisonFont,
    ),
  );
  const shimmerEnergy = [];
  context.period = "today";
  for (const [row, brightness] of [0.3, 0.6, 0.92].entries()) {
    comparisonCanvas.drawText(
      `${Math.round(brightness * 100)} %`,
      18,
      165 + row * 200,
      comparisonPaint,
      comparisonFont,
    );
    for (const [column, size] of [2.5, 4.4, 7.2].entries()) {
      context.layout.thoughts[0].size = size;
      context.layout.thoughts[0].ageOpacity = brightness;
      let unlit;
      for (const stage of ["matte", "glow"]) {
        context.renderingStage = stage;
        const surface = kit.MakeSurface(
          screenWidth,
          screenHeight - headerHeight,
        );
        const canvas = new JsiSkCanvas(kit, surface.getCanvas());
        canvas.drawColor(Skia.Color("#F2F3F5"));
        context.render(canvas);
        surface.flush();
        const image = surface.makeImageSnapshot();
        const pixels = image.readPixels(0, 0, {
          width: screenWidth,
          height: screenHeight - headerHeight,
          colorType: kit.ColorType.RGBA_8888,
          alphaType: kit.AlphaType.Unpremul,
          colorSpace: kit.ColorSpace.SRGB,
        });
        if (stage === "matte") unlit = pixels;
        else {
          let energy = 0;
          const radius = context.dotRadius(size, 1) * context.viewport.scale;
          for (let y = Math.floor(dotY - 30); y <= Math.ceil(dotY + 30); y++)
            for (
              let x = Math.floor(dotX - 30);
              x <= Math.ceil(dotX + 30);
              x++
            ) {
              if (Math.hypot(x + 0.5 - dotX, y + 0.5 - dotY) <= radius + 0.5)
                continue;
              const offset = (y * screenWidth + x) * 4;
              energy += Math.max(
                0,
                (pixels[offset] -
                  unlit[offset] +
                  pixels[offset + 1] -
                  unlit[offset + 1] +
                  pixels[offset + 2] -
                  unlit[offset + 2]) /
                  3,
              );
            }
          shimmerEnergy.push(energy);
          comparisonCanvas.drawImageRect(
            image,
            kit.XYWHRect(dotX - 32, dotY - 32, 64, 64),
            kit.XYWHRect(100 + column * 200, 78 + row * 200, 192, 192),
            comparisonPaint,
          );
        }
        image.delete();
        surface.delete();
      }
    }
  }
  for (let row = 0; row < 3; row++)
    assert(
      shimmerEnergy[row * 3] < shimmerEnergy[row * 3 + 1] &&
        shimmerEnergy[row * 3 + 1] < shimmerEnergy[row * 3 + 2],
      "Rendered shimmer grows with dot size",
    );
  for (let column = 0; column < 3; column++)
    assert(
      shimmerEnergy[column] < shimmerEnergy[column + 3] &&
        shimmerEnergy[column + 3] < shimmerEnergy[column + 6],
      "Rendered shimmer grows with visible brightness",
    );
  comparison.flush();
  const comparisonImage = comparison.makeImageSnapshot();
  fs.writeFileSync(
    path.join(output, "adaptive-shimmer.png"),
    comparisonImage.encodeToBytes(),
  );
  comparisonImage.delete();
  comparison.delete();
  comparisonPaint.delete();
  comparisonFont.delete();
  context.period = "all";
  context.layout = originalLayout;
  const selectionResets = [];
  Object.assign(context, {
    fittedPeriodRef: { current: null },
    overviewCamera: fitted,
    closeTimerRef: { current: null },
    thoughtCloseTimerRef: { current: null },
    protoCloseTimerRef: { current: null },
    themeClosingRef: { current: false },
    sheetY: { value: 0 },
    setSelectedThemeId: (value) => selectionResets.push(value),
    setSelectedProtoId: () => {},
    setSelectedThoughtNodeIndex: () => {},
  });
  context.applyFit();
  assert.equal(context.cameraX.value, fitted.x);
  assert.equal(context.zoom.value, fitted.zoom);
  context.yaw.value = 0.42;
  context.zoom.value = 2;
  context.applyFit();
  assert.equal(
    context.yaw.value,
    0.42,
    "Routine refresh must preserve the user orbit",
  );
  assert.equal(context.zoom.value, 2);
  context.period = "week";
  context.drill.value = 1;
  context.selectedThemeIndexSV.value = 2;
  context.applyFit();
  assert.equal(
    context.selectedThemeIndexSV.value,
    -1,
    "Changing period clears focus before fitting overview",
  );
  assert.equal(context.drill.value, 0);
  assert.equal(context.zoom.value, fitted.zoom);
  fs.writeFileSync(
    path.join(output, "report.json"),
    JSON.stringify(
      {
        fixture: "synthetic, 174 thoughts / 10 topics / 8 unassigned dots",
        cameraCases: 60,
        checkedLabels: labelCount,
        checkedLabelTaps,
        checkedAnchors,
        fittedMarks,
        exitCount,
        peakBloom,
        litPixels,
        peakAtmosphere,
        adaptiveLightCases,
        shimmerEnergy,
        fittedCamera: fitted,
        viewport: context.viewport,
        gestureCallbacks:
          "activation, interruption, fling cap, reduced motion, rotation at every focus/zoom, focal anchor, pointer arbitration, zoom bounds, finalization",
        ageValues,
        sizeValues,
        displayColors: context.layout.themes.map((theme) => theme.color),
        frames: report,
      },
      null,
      2,
    ),
  );
  console.log(
    `9 portrait Skia frames; ${fittedMarks} fitted marks, ${exitCount} empty-space exits; ${labelCount} cluster labels, ${checkedLabelTaps} actual label taps, ${checkedAnchors} rotated pinch anchors, age/size hierarchy and field boundaries verified. Output: ${output}`,
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
