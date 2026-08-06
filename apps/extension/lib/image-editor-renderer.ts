import {
  type ArrowSceneObject,
  type BlurSceneObject,
  getSceneRenderLayout,
  type ImageSceneObject,
  type RectangleSceneObject,
  type SceneDocument,
  type SceneObject,
  type SceneRenderLayout,
  type TextSceneObject,
} from "./image-editor";

const TEXT_WORD_PATTERN = /\s+/;

const createRoundRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void => {
  context.beginPath();
  context.roundRect(x, y, width, height, Math.max(0, radius));
};

const createBackground = (
  context: CanvasRenderingContext2D,
  scene: SceneDocument,
  layout: SceneRenderLayout
): string | CanvasGradient => {
  if (scene.background.type === "solid") {
    return scene.background.color;
  }
  const radians = (scene.background.angle * Math.PI) / 180;
  const centerX = layout.canvasWidth / 2;
  const centerY = layout.canvasHeight / 2;
  const radius = Math.hypot(layout.canvasWidth, layout.canvasHeight) / 2;
  const gradient = context.createLinearGradient(
    centerX - Math.cos(radians) * radius,
    centerY - Math.sin(radians) * radius,
    centerX + Math.cos(radians) * radius,
    centerY + Math.sin(radians) * radius
  );
  gradient.addColorStop(0, scene.background.color);
  gradient.addColorStop(1, scene.background.color2);
  return gradient;
};

const drawImageObject = (
  context: CanvasRenderingContext2D,
  object: ImageSceneObject,
  image: ImageBitmap
): void => {
  context.save();
  createRoundRect(
    context,
    -object.width / 2,
    -object.height / 2,
    object.width,
    object.height,
    object.radius
  );
  context.clip();
  context.filter = `brightness(${object.brightness}%) contrast(${object.contrast}%) saturate(${object.saturation}%)`;
  context.drawImage(
    image,
    object.crop.x * image.width,
    object.crop.y * image.height,
    object.crop.width * image.width,
    object.crop.height * image.height,
    -object.width / 2,
    -object.height / 2,
    object.width,
    object.height
  );
  context.restore();
};

const drawRectangleObject = (
  context: CanvasRenderingContext2D,
  object: RectangleSceneObject
): void => {
  createRoundRect(
    context,
    -object.width / 2,
    -object.height / 2,
    object.width,
    object.height,
    object.radius
  );
  context.fillStyle = object.fill;
  context.fill();
  if (object.strokeWidth > 0) {
    context.lineWidth = object.strokeWidth;
    context.strokeStyle = object.stroke;
    context.stroke();
  }
};

const drawArrowObject = (
  context: CanvasRenderingContext2D,
  object: ArrowSceneObject
): void => {
  const head = Math.max(12, object.strokeWidth * 4.5);
  context.beginPath();
  context.moveTo(-object.width / 2, 0);
  context.lineTo(object.width / 2, 0);
  context.moveTo(object.width / 2, 0);
  context.lineTo(object.width / 2 - head, -head * 0.55);
  context.moveTo(object.width / 2, 0);
  context.lineTo(object.width / 2 - head, head * 0.55);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = object.strokeWidth;
  context.shadowBlur = object.strokeWidth;
  context.shadowColor = "rgb(0 0 0 / 40%)";
  context.strokeStyle = object.stroke;
  context.stroke();
};

const wrapText = (
  context: CanvasRenderingContext2D,
  object: TextSceneObject
): readonly string[] => {
  context.font = `${object.fontWeight} ${object.fontSize}px ${object.fontFamily}`;
  const lines: string[] = [];
  for (const paragraph of object.text.split("\n")) {
    const words = paragraph.split(TEXT_WORD_PATTERN);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      const width =
        context.measureText(candidate).width +
        Math.max(0, candidate.length - 1) * object.letterSpacing;
      if (line && width > object.width) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
};

const fillSpacedText = (
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  letterSpacing: number
): void => {
  if (!letterSpacing) {
    context.fillText(text, x, y);
    return;
  }
  const characters = [...text];
  const widths = characters.map(
    (character) => context.measureText(character).width
  );
  const totalWidth =
    widths.reduce((sum, width) => sum + width, 0) +
    Math.max(0, text.length - 1) * letterSpacing;
  let cursor = x;
  if (context.textAlign === "center") {
    cursor -= totalWidth / 2;
  } else if (context.textAlign === "right") {
    cursor -= totalWidth;
  }
  for (const [index, character] of characters.entries()) {
    context.fillText(character, cursor, y);
    cursor += (widths[index] ?? 0) + letterSpacing;
  }
};

const drawTextObject = (
  context: CanvasRenderingContext2D,
  object: TextSceneObject
): void => {
  if (object.background !== "transparent") {
    context.fillStyle = object.background;
    createRoundRect(
      context,
      -object.width / 2,
      -object.height / 2,
      object.width,
      object.height,
      Math.min(18, object.fontSize * 0.35)
    );
    context.fill();
  }
  const lines = wrapText(context, object);
  const lineHeight = object.fontSize * object.lineHeight;
  const textHeight = lines.length * lineHeight;
  let x = -object.width / 2;
  if (object.align === "center") {
    x = 0;
  } else if (object.align === "right") {
    x = object.width / 2;
  }
  let y = -textHeight / 2 + object.fontSize;
  context.font = `${object.fontWeight} ${object.fontSize}px ${object.fontFamily}`;
  context.textAlign = object.align;
  context.textBaseline = "alphabetic";
  context.fillStyle = object.color;
  context.shadowBlur = object.shadow;
  context.shadowColor = "rgb(0 0 0 / 46%)";
  for (const line of lines) {
    fillSpacedText(context, line, x, y, object.letterSpacing);
    y += lineHeight;
  }
};

const drawObject = (
  context: CanvasRenderingContext2D,
  layout: SceneRenderLayout,
  object: Exclude<SceneObject, BlurSceneObject>,
  image: ImageBitmap
): void => {
  context.save();
  context.translate(
    layout.x + object.x * layout.scale,
    layout.y + object.y * layout.scale
  );
  context.rotate((object.rotation * Math.PI) / 180);
  context.scale(layout.scale, layout.scale);
  context.globalAlpha = object.opacity;

  if (object.kind === "image") {
    drawImageObject(context, object, image);
  } else if (object.kind === "text") {
    drawTextObject(context, object);
  } else if (object.kind === "rectangle") {
    drawRectangleObject(context, object);
  } else {
    drawArrowObject(context, object);
  }
  context.restore();
};

const drawBlurObject = (
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  layout: SceneRenderLayout,
  object: BlurSceneObject
): void => {
  const snapshot = document.createElement("canvas");
  snapshot.width = canvas.width;
  snapshot.height = canvas.height;
  snapshot.getContext("2d")?.drawImage(canvas, 0, 0);
  context.save();
  context.translate(
    layout.x + object.x * layout.scale,
    layout.y + object.y * layout.scale
  );
  context.rotate((object.rotation * Math.PI) / 180);
  context.scale(layout.scale, layout.scale);
  context.globalAlpha = object.opacity;
  context.beginPath();
  context.rect(
    -object.width / 2,
    -object.height / 2,
    object.width,
    object.height
  );
  context.clip();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.filter = `blur(${object.strength * layout.scale}px)`;
  context.drawImage(snapshot, 0, 0);
  context.restore();
};

const drawObjects = (
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  scene: SceneDocument,
  layout: SceneRenderLayout,
  image: ImageBitmap
): void => {
  for (const object of scene.objects) {
    if (!object.visible) {
      continue;
    }
    if (object.kind === "blur") {
      drawBlurObject(context, canvas, layout, object);
    } else {
      drawObject(context, layout, object, image);
    }
  }
};

export const drawImageEditorScene = (
  canvas: HTMLCanvasElement,
  scene: SceneDocument,
  image: ImageBitmap,
  maxEdge: number
): SceneRenderLayout => {
  const layout = getSceneRenderLayout(scene, maxEdge);
  canvas.width = layout.canvasWidth;
  canvas.height = layout.canvasHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("The browser does not support image editing.");
  }
  context.clearRect(0, 0, canvas.width, canvas.height);

  if (scene.background.enabled) {
    context.fillStyle = createBackground(context, scene, layout);
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.save();
    context.shadowBlur = scene.background.shadow * layout.scale;
    context.shadowColor = "rgb(0 0 0 / 42%)";
    context.shadowOffsetY = scene.background.shadow * layout.scale * 0.3;
    context.fillStyle = "#fff";
    createRoundRect(
      context,
      layout.x,
      layout.y,
      layout.width,
      layout.height,
      scene.background.radius * layout.scale
    );
    context.fill();
    context.restore();
    context.save();
    createRoundRect(
      context,
      layout.x,
      layout.y,
      layout.width,
      layout.height,
      scene.background.radius * layout.scale
    );
    context.clip();
    drawObjects(context, canvas, scene, layout, image);
    context.restore();
  } else {
    drawObjects(context, canvas, scene, layout, image);
  }
  return layout;
};
