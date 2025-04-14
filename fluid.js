import AutoBind from 'https://cdn.skypack.dev/auto-bind'
import debounce from 'https://cdn.skypack.dev/lodash/debounce'
import { Camera, Color, Geometry, Post, Program, Mesh, Renderer, RenderTarget, Vec2, Plane, Transform, Texture } from 'https://cdn.skypack.dev/ogl'
import Lenis from 'https://cdn.jsdelivr.net/npm/@studio-freight/lenis@1.0.42/dist/lenis.mjs';


// polyfills
if (window.HTMLElement && !HTMLElement.prototype.forEach) {
  HTMLElement.prototype.forEach = function (callback, thisArg) {
    thisArg = thisArg || window

    callback.call(thisArg, this, this, this)
  }
}

if (window.NodeList && !NodeList.prototype.forEach) {
  NodeList.prototype.forEach = function (callback, thisArg) {
    thisArg = thisArg || window

    for (var i = 0; i < this.length; i++) {
      callback.call(thisArg, this[i], i, this)
    }
  }
}

if (window.NodeList && !NodeList.prototype.map) {
  NodeList.prototype.map = Array.prototype.map
}

if (window.NodeList && !NodeList.prototype.find) {
  NodeList.prototype.find = Array.prototype.find
}

if (window.NodeList && !NodeList.prototype.filter) {
  NodeList.prototype.filter = Array.prototype.filter
}

// sprites
(async function () {
  const request = await window.fetch('/assets/bundle.svg')
  const response = await request.text()

  const sprite = document.createElement('div')

  sprite.innerHTML = response

  sprite.style.left = '-999999px'
  sprite.style.opacity = 0
  sprite.style.position = 'absolute'
  sprite.style.top = 0

  document.body.appendChild(sprite)
})()

//breakpoints

const BREAKPOINT_PHONE = 768
const BREAKPOINT_TABLET = 1024
const BREAKPOINT_DESKTOP = 1920


//get bounds
const getBounds = (element) => {
  const bounds = element.getBoundingClientRect()
  const scroll = window.scrollY ?? 0

  return {
    bottom: bounds.bottom + scroll,
    height: bounds.height,
    left: bounds.left,
    right: bounds.right,
    top: bounds.top + scroll,
    width: bounds.width,
  }
}

const DOMUtils = {
  getBounds,
}



// canvas imports

const advectionManualFilteringShader = `
precision highp float;
precision highp sampler2D;

varying vec2 vUv;

uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform vec2 dyeTexelSize;
uniform float dt;
uniform float dissipation;

vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
  vec2 st = uv / tsize - 0.5;
  
  vec2 iuv = floor(st);
  vec2 fuv = fract(st);

  vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
  vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
  vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
  vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);

  return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
}

void main () {
  vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;

  gl_FragColor = dissipation * bilerp(uSource, coord, dyeTexelSize);
  gl_FragColor.a = 1.0;
}


`
const advectionShader = `

precision highp float;
precision highp sampler2D;

varying vec2 vUv;

uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 texelSize;
uniform float dt;
uniform float dissipation;

void main () {
  vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;

  gl_FragColor = dissipation * texture2D(uSource, coord);
  gl_FragColor.a = 1.0;
}

`
const baseVertex = `
precision highp float;

attribute vec2 position;
attribute vec2 uv;

varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;

uniform vec2 texelSize;

void main () {
  vUv = uv;

  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);

  gl_Position = vec4(position, 0, 1);
}


`
const clearShader = `
precision mediump float;
precision mediump sampler2D;

varying highp vec2 vUv;

uniform sampler2D uTexture;
uniform float value;

void main () {
  gl_FragColor = value * texture2D(uTexture, vUv);
}

`
const curlShader = `

precision mediump float;
precision mediump sampler2D;

varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;

uniform sampler2D uVelocity;

void main () {
  float L = texture2D(uVelocity, vL).y;
  float R = texture2D(uVelocity, vR).y;
  float T = texture2D(uVelocity, vT).x;
  float B = texture2D(uVelocity, vB).x;

  float vorticity = R - L - T + B;

  gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0);
}


`
const divergenceShader = `

precision mediump float;
precision mediump sampler2D;

varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;

uniform sampler2D uVelocity;

void main () {
  float L = texture2D(uVelocity, vL).x;
  float R = texture2D(uVelocity, vR).x;
  float T = texture2D(uVelocity, vT).y;
  float B = texture2D(uVelocity, vB).y;

  vec2 C = texture2D(uVelocity, vUv).xy;

  if (vL.x < 0.0) { L = -C.x; }
  if (vR.x > 1.0) { R = -C.x; }
  if (vT.y > 1.0) { T = -C.y; }
  if (vB.y < 0.0) { B = -C.y; }

  float div = 0.5 * (R - L + T - B);

  gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
}


`
const fragment = `

precision highp float;

uniform sampler2D tMap;
uniform sampler2D tFluid;
uniform float uTime;
varying vec2 vUv;

void main() {
  vec3 fluid = texture2D(tFluid, vUv).rgb;
  vec2 uv = vUv;
  vec2 uv2 = vUv - fluid.rg * 0.0003;

  vec4 color = texture2D(tMap, uv2);

  vec3 rgb = fluid * 0.003;

  color.r = texture2D(tMap, vec2(uv.x + rgb.x, uv.y + rgb.y)).r;
  color.g = texture2D(tMap, vec2(uv.x - rgb.x, uv.y + rgb.y)).g;
  color.b = texture2D(tMap, vec2(uv.x - rgb.x, uv.y + rgb.y)).b;

  gl_FragColor = color;
}


`
const gradientSubtractShader = `

precision mediump float;
precision mediump sampler2D;

varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;

uniform sampler2D uPressure;
uniform sampler2D uVelocity;

void main () {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;

  vec2 velocity = texture2D(uVelocity, vUv).xy;

  velocity.xy -= vec2(R - L, T - B);

  gl_FragColor = vec4(velocity, 0.0, 1.0);
}


`
const pressureShader = `

precision mediump float;
precision mediump sampler2D;

varying highp vec2 vUv;
varying highp vec2 vL;
varying highp vec2 vR;
varying highp vec2 vT;
varying highp vec2 vB;

uniform sampler2D uPressure;
uniform sampler2D uDivergence;

void main () {
  float L = texture2D(uPressure, vL).x;
  float R = texture2D(uPressure, vR).x;
  float T = texture2D(uPressure, vT).x;
  float B = texture2D(uPressure, vB).x;
  float C = texture2D(uPressure, vUv).x;

  float divergence = texture2D(uDivergence, vUv).x;
  float pressure = (L + R + B + T - divergence) * 0.25;

  gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
}


`
const splatShader = `

precision highp float;
precision highp sampler2D;

varying vec2 vUv;

uniform sampler2D uTarget;
uniform float aspectRatio;
uniform vec3 color;
uniform vec2 point;
uniform float radius;

void main () {
  vec2 p = vUv - point.xy;

  p.x *= aspectRatio;

  vec3 splat = exp(-dot(p, p) / radius) * color;
  vec3 base = texture2D(uTarget, vUv).xyz;

  gl_FragColor = vec4(base + splat, 1.0);
}


`
const vorticityShader = `

precision highp float;
precision highp sampler2D;

varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;

uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform float curl;
uniform float dt;

void main () {
  float L = texture2D(uCurl, vL).x;
  float R = texture2D(uCurl, vR).x;
  float T = texture2D(uCurl, vT).x;
  float B = texture2D(uCurl, vB).x;
  float C = texture2D(uCurl, vUv).x;

  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));

  force /= length(force) + 0.0001;
  force *= curl * C;
  force.y *= -1.0;

  vec2 vel = texture2D(uVelocity, vUv).xy;

  gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
}


`


// background

const backgroundFragment = `

precision highp float;

uniform sampler2D tMap;
uniform vec4 uResolution;

varying vec2 vUv;

void main() {
  vec2 uv = (vUv - vec2(0.5)) * uResolution.zw + vec2(0.5);
  vec4 color = texture2D(tMap, uv);

  gl_FragColor = color;
}


`
const backgroundVertex = `

precision highp float;

attribute vec2 uv;
attribute vec3 position;
attribute vec3 normal;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;

varying vec2 vUv;

void main() {
  vUv = uv;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}


`
const mediaFragment = `

precision highp float;

uniform sampler2D tMap;
uniform vec4 uResolution;
uniform vec2 imageSize;
uniform vec2 containerSize;

varying vec2 vUv;

const float uBorderRadius = 0.025;



vec2 cover(vec2 uv, vec2 containerSize, vec2 imageSize) {
   float containerRatio = containerSize.x / containerSize.y;
   float imageRatio = imageSize.x / imageSize.y;
   vec2 scale;
   vec2 offset;
   if(imageRatio > containerRatio) {
      scale = vec2(containerSize.y / imageSize.y);
      offset = vec2((containerSize.x - imageSize.x * scale.x) * 0.5, 0.0);
   } else {
      scale = vec2(containerSize.x / imageSize.x);
      offset = vec2(0.0, (containerSize.y - imageSize.y * scale.y) * 0.5);
   }
   vec2 adjustedUV = (uv * containerSize - offset) / (imageSize * scale);
   return adjustedUV;
}




float calcDistance(vec2 uv) {
  vec2 position = abs(uv * 2.0 - 1.0);
  vec2 extend = vec2(uResolution.xy) / 2.0;
  vec2 coords = position * (extend + uBorderRadius);
  vec2 delta = max(coords - extend, 0.0);

  return length(delta);
}




void main() {
  vec2 uv = (vUv - vec2(0.5)) * uResolution.zw + vec2(0.5);
  vec4 color = texture2D(tMap, uv);

  float dist = calcDistance(vUv);
  
  if (dist > uBorderRadius) {
    discard;
  }

  gl_FragColor = color;
}


`
const mediaVertex = `

precision highp float;

attribute vec2 uv;
attribute vec3 position;
attribute vec3 normal;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;

varying vec2 vUv;

void main() {
  vUv = uv;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}


`
const textFragment = `

precision highp float;

uniform sampler2D tMap;
uniform vec4 uResolution;
uniform float uAlpha;

varying vec2 vUv;

void main() {
  vec2 uv = (vUv - vec2(0.5)) * uResolution.zw + vec2(0.5);
  vec4 color = texture2D(tMap, uv);
  
  // Output the color directly, apply alpha
  gl_FragColor = vec4(color.rgb, color.a * uAlpha);
}


`
const textVertex = `

precision highp float;

attribute vec2 uv;
attribute vec3 position;
attribute vec3 normal;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;

varying vec2 vUv;

void main() {
  vUv = uv;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}


`








function roundRect(context, x, y, width, height, radius = 5) {
  radius = { tl: radius, tr: radius, br: radius, bl: radius }

  context.beginPath()
  context.moveTo(x + radius.tl, y)
  context.lineTo(x + width - radius.tr, y)
  context.quadraticCurveTo(x + width, y, x + width, y + radius.tr)
  context.lineTo(x + width, y + height - radius.br)
  context.quadraticCurveTo(x + width, y + height, x + width - radius.br, y + height)
  context.lineTo(x + radius.bl, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - radius.bl)
  context.lineTo(x, y + radius.tl)
  context.quadraticCurveTo(x, y, x + radius.tl, y)
  context.closePath()

  context.stroke()
}
class Background {
  constructor({ canvas, element, geometry, scene }) {
    this.canvas = canvas
    this.element = element
    this.geometry = geometry
    this.scene = scene

    this.element.setAttribute('data-gl-text-active', '')

    this.bounds = getBounds(this.element)

    const canvasBackground = document.createElement('canvas')
    const context = canvasBackground.getContext('2d')

    const offset = this.element.querySelector('[data-gl-background-line]').offsetLeft
    const border = 2 * 2
    const height = this.bounds.height * 2
    const width = this.bounds.width * 2

    canvasBackground.height = height
    canvasBackground.width = width

    context.strokeStyle = '#fff'
    context.lineWidth = border

    context.beginPath()
    context.moveTo(offset * 2, 0)
    context.lineTo(offset * 2, width - border / 2)
    context.stroke()
    context.closePath()

    roundRect(context, 1, 1, width - border / 2, height - border / 2, 15)

    this.createImage(canvasBackground)
  }

  createImage(canvas) {
    const image = document.createElement('img')

    image.onload = () => {
      this.createMesh(image)
    }

    image.src = canvas.toDataURL('image/webp', 1)
  }

  createMesh(image) {
    const texture = new Texture(this.canvas.gl, {
      premultiplyAlpha: true,
    })

    texture.image = image

    const program = new Program(this.canvas.gl, {
      fragment: backgroundFragment,
      uniforms: {
        tMap: { value: texture },
        tCover: { value: null },
        uAlpha: { value: 1 },
        uNoise: { value: 0 },
        uOpacity: { value: 1 },
        uResolution: { value: [0, 0, 0, 0] },
        uTime: { value: 0 },
        uTransition: { value: 0 },
      },
      vertex: backgroundVertex,
    })

    this.mesh = new Mesh(this.canvas.gl, {
      geometry: this.geometry,
      program,
    })

    this.mesh.setParent(this.scene)
  }

  onResize() {
    this.bounds = getBounds(this.element)
  }

  onLoop(scroll) {
    if (!this.bounds) return
    if (!this.mesh) return

    const aspect = this.bounds.height / this.bounds.width

    let a1
    let a2

    if (this.mesh.scale.y / this.mesh.scale.x > aspect) {
      a1 = (this.mesh.scale.x / this.mesh.scale.y) * aspect
      a2 = 1
    } else {
      a1 = 1
      a2 = this.mesh.scale.y / this.mesh.scale.x / aspect
    }

    this.mesh.program.uniforms.uResolution.value = [this.mesh.scale.x, this.mesh.scale.y, a1, a2]

    this.mesh.scale.x = (this.canvas.sizes.x * this.bounds.width) / this.canvas.viewport.x
    this.mesh.scale.y = (this.canvas.sizes.y * this.bounds.height) / this.canvas.viewport.y

    const x = this.bounds.left
    const y = this.bounds.top - scroll

    const xFix = -(this.canvas.sizes.x / 2) + this.mesh.scale.x / 2
    const yFix = this.canvas.sizes.y / 2 - this.mesh.scale.y / 2

    this.mesh.position.x = xFix + (x / this.canvas.viewport.x) * this.canvas.sizes.x
    this.mesh.position.y = yFix - (y / this.canvas.viewport.y) * this.canvas.sizes.y
  }
}


class Media {
  constructor({ canvas, element, geometry, scene }) {
    // console.log('Creating Media instance')
    this.canvas = canvas
    this.element = element
    this.geometry = geometry
    this.scene = scene

    // Find the img element within the container
    this.imgElement = this.element.querySelector('img')
    if (!this.imgElement) {
      // console.error('No img element found in media container')
      return
    }

    this.imgElement.setAttribute('crossorigin', 'anonymous')
    this.imgElement.setAttribute('data-gl-media-active', '')

    this.createTexture()
    this.createMesh()
  }

  createTexture() {
    // console.log('Creating texture')
    this.texture = new Texture(this.canvas.gl, {
      premultiplyAlpha: true,
    })

    this.imgElement.onload = () => {
      // console.log('Image loaded')
      this.texture.image = this.imgElement
      this.texture.needsUpdate = true
    }
  }

  createMesh() {
    // console.log('Creating mesh')
    this.program = new Program(this.canvas.gl, {
      fragment: mediaFragment,
      uniforms: {
        tMap: { value: this.texture },
        tCover: { value: null },
        uAlpha: { value: 1 },
        uNoise: { value: 0 },
        uOpacity: { value: 1 },
        uResolution: { value: [0, 0, 0, 0] },
        uTime: { value: 0 },
        uTransition: { value: 0 }
      },
      vertex: mediaVertex,
      transparent: true,
    })

    this.mesh = new Mesh(this.canvas.gl, {
      geometry: this.geometry,
      program: this.program,
    })

    this.mesh.setParent(this.scene)
  }

  onResize() {
    this.bounds = getBounds(this.imgElement)
  }

  onLoop(scroll) {
    if (!this.bounds) return
    if (!this.mesh) return

    const aspect = this.bounds.height / this.bounds.width

    let a1
    let a2

    if (this.mesh.scale.y / this.mesh.scale.x > aspect) {
      a1 = (this.mesh.scale.x / this.mesh.scale.y) * aspect
      a2 = 1
    } else {
      a1 = 1
      a2 = this.mesh.scale.y / this.mesh.scale.x / aspect
    }

    this.mesh.program.uniforms.uResolution.value = [this.mesh.scale.x, this.mesh.scale.y, a1, a2]

    this.mesh.scale.x = (this.canvas.sizes.x * this.bounds.width) / this.canvas.viewport.x
    this.mesh.scale.y = (this.canvas.sizes.y * this.bounds.height) / this.canvas.viewport.y

    const x = this.bounds.left
    const y = this.bounds.top - scroll

    const xFix = -(this.canvas.sizes.x / 2) + this.mesh.scale.x / 2
    const yFix = this.canvas.sizes.y / 2 - this.mesh.scale.y / 2

    this.mesh.position.x = xFix + (x / this.canvas.viewport.x) * this.canvas.sizes.x
    this.mesh.position.y = yFix - (y / this.canvas.viewport.y) * this.canvas.sizes.y
  }
}


class Text {
  constructor({ canvas, element, geometry, scene }) {
    this.canvas = canvas
    this.element = element
    this.geometry = geometry
    this.scene = scene

    this.color = this.element.dataset.color || 'white'

    this.element.setAttribute('data-gl-text-active', '')
    this.bounds = getBounds(this.element)

    const canvasText = document.createElement('canvas')
    const context = canvasText.getContext('2d')

    const dpr = Math.min(window.devicePixelRatio, 2)

    canvasText.height = this.bounds.height * dpr
    canvasText.width = this.bounds.width * dpr

    // Get computed styles
    const computedStyle = getComputedStyle(this.element)
    const { fontFamily, fontSize, letterSpacing, lineHeight, color } = computedStyle
    const fontSizeValue = parseFloat(fontSize.replace('px', ''))
    const lineHeightValue = parseFloat(lineHeight.replace('px', '')) || fontSizeValue * 1.2 // Default line height

    // Set canvas context properties for text measurement and drawing
    // context.fillStyle = '#ff0000'
    context.font = `${fontSizeValue * dpr}px ${fontFamily || 'sans-serif'}`
    context.textBaseline = 'top' // Use top baseline for multi-line
    context.textAlign = 'left' // Use left align for multi-line

    // Get text content
    let text = this.element.textContent.trim()
    if (this.element.dataset.glText === 'uppercase') {
      text = text.toUpperCase()
    }

    // --- Word Wrapping Logic --- 
    const words = text.split(' ')
    const lines = []
    let currentLine = ''

    for (let i = 0; i < words.length; i++) {
      const testLine = currentLine + (currentLine ? ' ' : '') + words[i]
      const metrics = context.measureText(testLine)
      const testWidth = metrics.width

      if (testWidth > canvasText.width && i > 0) {
        lines.push(currentLine)
        currentLine = words[i]
      } else {
        currentLine = testLine
      }
    }
    lines.push(currentLine) // Add the last line
    // --- End Word Wrapping --- 

    // Clear the canvas (transparent background)
    context.clearRect(0, 0, canvasText.width, canvasText.height)
    
    // Set text color
    context.fillStyle =  this.color // Use computed color or default to white

    // Draw each calculated line
    lines.forEach((line, index) => {
      const y = index * lineHeightValue * dpr
      context.fillText(line, 0, y)
    })

    this.createImage(canvasText)
  }

  createImage(canvas) {
    const image = document.createElement('img')
    image.onload = () => {
      // console.log('Text image loaded with dimensions:', image.width, image.height)
      this.createMesh(image)
    }
    image.onerror = () => {
      // console.error('Failed to load text image')
    }
    image.src = canvas.toDataURL('image/webp', 1)
  }

  createMesh(image) {
    const texture = new Texture(this.canvas.gl, {
      premultiplyAlpha: true,
      image: image
    })

    texture.needsUpdate = true

    const program = new Program(this.canvas.gl, {
      fragment: textFragment,
      vertex: textVertex,
      uniforms: {
        tMap: { value: texture },
        tCover: { value: null },
        uAlpha: { value: 1 },
        uNoise: { value: 0 },
        uOpacity: { value: 1 },
        uResolution: { value: [0, 0, 0, 0] },
        uTime: { value: 0 },
        uTransition: { value: 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })

    this.mesh = new Mesh(this.canvas.gl, {
      geometry: this.geometry,
      program,
    })

    this.mesh.setParent(this.scene)
    // console.log('Text Mesh created:', this.mesh)
    
    this.onResize()
  }

  onResize() {
    if (!this.mesh) return
    this.bounds = getBounds(this.element)

    this.mesh.scale.x = (this.canvas.sizes.x * this.bounds.width) / this.canvas.viewport.x
    this.mesh.scale.y = (this.canvas.sizes.y * this.bounds.height) / this.canvas.viewport.y
    
    this.updatePosition(this.canvas.lenis ? this.canvas.lenis.scroll : 0)
  }

  updatePosition(scroll) {
    if (!this.bounds || !this.mesh) return
    
    const x = this.bounds.left
    const y = this.bounds.top - scroll

    const xFix = -(this.canvas.sizes.x / 2) + this.mesh.scale.x / 2
    const yFix = this.canvas.sizes.y / 2 - this.mesh.scale.y / 2

    this.mesh.position.x = xFix + (x / this.canvas.viewport.x) * this.canvas.sizes.x
    this.mesh.position.y = yFix - (y / this.canvas.viewport.y) * this.canvas.sizes.y
  }

  onLoop(scroll) {
    this.updatePosition(scroll)

    if (!this.bounds || !this.mesh) return

    const aspect = this.bounds.height / this.bounds.width
    let a1 = 1, a2 = 1

    if (this.mesh.scale.y / this.mesh.scale.x > aspect) {
      a1 = (this.mesh.scale.x / this.mesh.scale.y) * aspect
    } else {
      a2 = (this.mesh.scale.y / this.mesh.scale.x) / aspect
    }

    this.mesh.program.uniforms.uResolution.value = [this.mesh.scale.x, this.mesh.scale.y, a1, a2]
  }
}




class Home extends Transform {
  constructor({ canvas }) {
    super()

    this.canvas = canvas

    const geometry = new Plane(this.canvas.gl, {
      heightSegments: 1,
      widthSegments: 1,
    })

    this.backgrounds = document.querySelectorAll('[data-gl-background]').map(
      (element) =>
        new Background({
          canvas: this.canvas,
          element,
          geometry,
          scene: this,
        }),
    )

    this.medias = document.querySelectorAll('[data-gl-media]').map(
      (element) =>
        new Media({
          canvas: this.canvas,
          element,
          geometry,
          scene: this,
        }),
    )

    this.texts = document.querySelectorAll('[data-gl-text]').map(
      (element) =>
        new Text({
          canvas: this.canvas,
          element,
          geometry,
          scene: this,
        }),
    )
  }

  onResize() {
    this.backgrounds?.forEach((background) => background.onResize())
    this.medias?.forEach((media) => media.onResize())
    this.texts?.forEach((text) => text.onResize())
  }

  onLoop(scroll) {
    this.backgrounds?.forEach((background) => background.onLoop(scroll))
    this.medias?.forEach((media) => media.onLoop(scroll))
    this.texts?.forEach((text) => text.onLoop(scroll))
  }
}


// home ends





export const renderer = new Renderer({
  alpha: true,
  antialias: true,
  dpr: window.devicePixelRatio,
})

export const gl = renderer.gl

function getSupportedFormat(gl, internalFormat, format, type) {
  if (!supportRenderTextureFormat(gl, internalFormat, format, type)) {
    // prettier-ignore
    switch (internalFormat) {
      case gl.R16F: return getSupportedFormat(gl, gl.RG16F, gl.RG, type)
      case gl.RG16F: return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type)
      default: return null
    }
  }

  return { internalFormat, format }
}

function supportRenderTextureFormat(gl, internalFormat, format, type) {
  let texture = gl.createTexture()

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null)

  let fbo = gl.createFramebuffer()

  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)

  if (status != gl.FRAMEBUFFER_COMPLETE) {
    return false
  }

  return true
}

function createDoubleFBO(
  gl,
  {
    width,
    height,
    wrapS,
    wrapT,
    minFilter = gl.LINEAR,
    magFilter = minFilter,
    type,
    format,
    internalFormat,
    depth,
  } = {},
) {
  const options = { width, height, wrapS, wrapT, minFilter, magFilter, type, format, internalFormat, depth }

  const fbo = {
    read: new RenderTarget(gl, options),
    write: new RenderTarget(gl, options),
    swap: () => {
      let temp = fbo.read
      fbo.read = fbo.write
      fbo.write = temp
    },
  }

  return fbo
}

const SIMULATION_RESOLUTION = 128
const DYE_RESOLUTION = 512
const ITERATIONS = 3

let densityDissipation = 0.93
let velocityDissipation = 0.9
let pressureDissipation = 0.8
let curlStrength = 20
let radius = 0.3

const texelSize = {
  value: new Vec2(1 / SIMULATION_RESOLUTION),
}

// Get supported formats and types for FBOs
const supportLinearFiltering = gl.renderer.extensions[`OES_texture_${gl.renderer.isWebgl2 ? `` : `half_`}float_linear`]
const halfFloat = gl.renderer.isWebgl2 ? gl.HALF_FLOAT : gl.renderer.extensions['OES_texture_half_float'].HALF_FLOAT_OES
const filtering = supportLinearFiltering ? gl.LINEAR : gl.NEAREST

let rgba, rg, r

if (gl.renderer.isWebgl2) {
  rgba = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloat)
  rg = getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloat)
  r = getSupportedFormat(gl, gl.R16F, gl.RED, halfFloat)
} else {
  rgba = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloat)
  rg = rgba
  r = rgba
}

gl.renderer.getExtension('OES_standard_derivatives')

const lastMouse = new Vec2()

const KEYS = {
  37: 'left',
  38: 'up',
  39: 'right',
  40: 'down',
  65: 'a',
  66: 'b',
}

const KONAMI = ['up', 'up', 'down', 'down', 'left', 'right', 'left', 'right', 'b', 'a']

class Canvas {
  constructor() {
    // console.log('Canvas constructor called')
    AutoBind(this)

    this.createScroll()
    this.createRenderer()
    this.createCamera()
    this.createPost()
    this.createMouseFluid()

    this.createScene()

    this.onResize({
      height: window.innerHeight,
      width: window.innerWidth,
    })

    this.onResize = debounce(this.onResize.bind(this), 400)

    window.addEventListener('resize', this.onResize)

    this.onLoop()

    this.isKonami = false
    this.konamiCodePosition = 0

    document.addEventListener('keydown', this.onKeydown.bind(this))
    // console.log('Canvas initialization complete')
  }

  onKeydown({ keyCode }) {
    const key = KEYS[keyCode]
    const requiredKey = KONAMI[this.konamiCodePosition]

    // compare the key with the required key
    if (key == requiredKey) {
      // move to the next key in the konami code sequence
      this.konamiCodePosition++

      // if the last key is reached, activate cheats
      if (this.konamiCodePosition == KONAMI.length) {
        this.activateCheats()

        this.konamiCodePosition = 0
      }
    } else {
      this.konamiCodePosition = 0
    }
  }

  activateCheats() {
    if (this.isKonami) {
      densityDissipation = 0.93
    } else {
      densityDissipation = 0.99
    }

    this.isKonami = !this.isKonami
  }

  createScroll() {
    this.lenis = new Lenis({
      
    })
  }

  createRenderer() {
    this.renderer = renderer

    this.gl = renderer.gl
    this.gl.canvas.classList.add('canvas')

    document.body.appendChild(this.gl.canvas)

  }

  createPost() {
    this.post = new Post(this.gl)

    this.pass = this.post.addPass({
      fragment,
      uniforms: {
        tFluid: { value: null },
        uTime: { value: 0 },
      },
    })
  }

  createMouseFluid() {
    // Create fluid simulation FBOs
    this.density = createDoubleFBO(this.gl, {
      width: DYE_RESOLUTION,
      height: DYE_RESOLUTION,
      type: halfFloat,
      format: rgba?.format,
      internalFormat: rgba?.internalFormat,
      minFilter: filtering,
      depth: false,
    })

    this.velocity = createDoubleFBO(this.gl, {
      width: SIMULATION_RESOLUTION,
      height: SIMULATION_RESOLUTION,
      type: halfFloat,
      format: rg?.format,
      internalFormat: rg?.internalFormat,
      minFilter: filtering,
      depth: false,
    })

    this.pressure = createDoubleFBO(this.gl, {
      width: SIMULATION_RESOLUTION,
      height: SIMULATION_RESOLUTION,
      type: halfFloat,
      format: r?.format,
      internalFormat: r?.internalFormat,
      minFilter: gl.NEAREST,
      depth: false,
    })

    this.divergence = new RenderTarget(this.gl, {
      width: SIMULATION_RESOLUTION,
      height: SIMULATION_RESOLUTION,
      type: halfFloat,
      format: r?.format,
      internalFormat: r?.internalFormat,
      minFilter: gl.NEAREST,
      depth: false,
    })

    this.curl = new RenderTarget(this.gl, {
      width: SIMULATION_RESOLUTION,
      height: SIMULATION_RESOLUTION,
      type: halfFloat,
      format: r?.format,
      internalFormat: r?.internalFormat,
      minFilter: gl.NEAREST,
      depth: false,
    })

    // Geometry to be used for the simulation programs
    this.triangle = new Geometry(this.gl, {
      position: { size: 2, data: new Float32Array([-1, -1, 3, -1, -1, 3]) },
      uv: { size: 2, data: new Float32Array([0, 0, 2, 0, 0, 2]) },
    })

    // Create fluid simulation programs
    this.clearProgram = new Mesh(this.gl, {
      geometry: this.triangle,
      program: new Program(this.gl, {
        vertex: baseVertex,
        fragment: clearShader,
        uniforms: {
          texelSize,
          uTexture: { value: null },
          value: { value: pressureDissipation },
        },
        depthTest: false,
        depthWrite: false,
      }),
    })

    this.splatProgram = new Mesh(this.gl, {
      geometry: this.triangle,
      program: new Program(this.gl, {
        vertex: baseVertex,
        fragment: splatShader,
        uniforms: {
          texelSize,
          uTarget: { value: null },
          aspectRatio: { value: 1 },
          color: { value: new Color() },
          point: { value: new Vec2() },
          radius: { value: radius / 100 },
        },
        depthTest: false,
        depthWrite: false,
      }),
    })

    this.advectionProgram = new Mesh(this.gl, {
      geometry: this.triangle,
      program: new Program(this.gl, {
        vertex: baseVertex,
        fragment: supportLinearFiltering ? advectionShader : advectionManualFilteringShader,
        uniforms: {
          texelSize,
          dyeTexelSize: { value: new Vec2(1 / DYE_RESOLUTION) },
          uVelocity: { value: null },
          uSource: { value: null },
          dt: { value: 0.016 },
          dissipation: { value: 1 },
        },
        depthTest: false,
        depthWrite: false,
      }),
    })

    this.divergenceProgram = new Mesh(this.gl, {
      geometry: this.triangle,
      program: new Program(this.gl, {
        vertex: baseVertex,
        fragment: divergenceShader,
        uniforms: {
          texelSize,
          uVelocity: { value: null },
        },
        depthTest: false,
        depthWrite: false,
      }),
    })

    this.curlProgram = new Mesh(this.gl, {
      geometry: this.triangle,
      program: new Program(this.gl, {
        vertex: baseVertex,
        fragment: curlShader,
        uniforms: {
          texelSize,
          uVelocity: { value: null },
        },
        depthTest: false,
        depthWrite: false,
      }),
    })

    this.vorticityProgram = new Mesh(this.gl, {
      geometry: this.triangle,
      program: new Program(this.gl, {
        vertex: baseVertex,
        fragment: vorticityShader,
        uniforms: {
          texelSize,
          uVelocity: { value: null },
          uCurl: { value: null },
          curl: { value: curlStrength },
          dt: { value: 0.016 },
        },
        depthTest: false,
        depthWrite: false,
      }),
    })

    this.pressureProgram = new Mesh(this.gl, {
      geometry: this.triangle,
      program: new Program(this.gl, {
        vertex: baseVertex,
        fragment: pressureShader,
        uniforms: {
          texelSize,
          uPressure: { value: null },
          uDivergence: { value: null },
        },
        depthTest: false,
        depthWrite: false,
      }),
    })

    this.gradientSubtractProgram = new Mesh(this.gl, {
      geometry: this.triangle,
      program: new Program(this.gl, {
        vertex: baseVertex,
        fragment: gradientSubtractShader,
        uniforms: {
          texelSize,
          uPressure: { value: null },
          uVelocity: { value: null },
        },
        depthTest: false,
        depthWrite: false,
      }),
    })

    this.splats = []

    // Create handlers to get mouse position and velocity
    window.addEventListener('touchstart', this.updateMouse, false)
    window.addEventListener('touchmove', this.updateMouse, false)
    window.addEventListener('mousemove', this.updateMouse, false)
  }

  createCamera() {
    this.camera = new Camera(this.gl)
    this.camera.fov = 45
    this.camera.position.z = 2
    
  }

  createScene() {
    this.scene = new Home({
      canvas: this,
    })
  }

  updateMouse(e) {
    
    if (e.changedTouches && e.changedTouches.length) {
      e.x = e.changedTouches[0].pageX
      e.y = e.changedTouches[0].pageY
    }
    if (e.x === undefined) {
      e.x = e.pageX
      e.y = e.pageY
    }

    if (!lastMouse.isInit) {
      lastMouse.isInit = true

      // First input
      lastMouse.set(e.x, e.y)
    }

    const deltaX = e.x - lastMouse.x
    const deltaY = e.y - lastMouse.y

    lastMouse.set(e.x, e.y)

    // Add if the mouse is moving
    if (Math.abs(deltaX) || Math.abs(deltaY)) {
      this.splats.push({
        // Get mouse value in 0 to 1 range, with y flipped
        x: e.x / gl.renderer.width,
        y: 1 - e.y / gl.renderer.height,
        dx: deltaX * 5,
        dy: deltaY * -5,
      })
    }
  }

  // Function to draw number of interactions onto input render target
  splat({ x, y, dx, dy }) {
    this.splatProgram.program.uniforms.uTarget.value = this.velocity.read.texture
    this.splatProgram.program.uniforms.aspectRatio.value = gl.renderer.width / gl.renderer.height
    this.splatProgram.program.uniforms.point.value.set(x, y)
    this.splatProgram.program.uniforms.color.value.set(dx, dy, 1)

    gl.renderer.render({
      scene: this.splatProgram,
      target: this.velocity.write,
      sort: false,
      update: false,
    })

    this.velocity.swap()

    this.splatProgram.program.uniforms.uTarget.value = this.density.read.texture

    gl.renderer.render({
      scene: this.splatProgram,
      target: this.density.write,
      sort: false,
      update: false,
    })

    this.density.swap()
  }

  //
  // Events.
  //
  onLoop(now) {
    this.lenis?.raf(now)

    if (window.innerWidth <= BREAKPOINT_PHONE) {
      return window.requestAnimationFrame(this.onLoop.bind(this))
    }

    // Perform all of the fluid simulation renders
    // No need to clear during sim, saving a number of GL calls.
    this.renderer.autoClear = false

    // Render all of the inputs since last frame
    for (let i = this.splats.length - 1; i >= 0; i--) {
      this.splat(this.splats.splice(i, 1)[0])
    }

    this.curlProgram.program.uniforms.uVelocity.value = this.velocity.read.texture

    this.renderer.render({
      scene: this.curlProgram,
      target: this.curl,
      sort: false,
      update: false,
    })

    this.vorticityProgram.program.uniforms.uVelocity.value = this.velocity.read.texture
    this.vorticityProgram.program.uniforms.uCurl.value = this.curl.texture

    this.renderer.render({
      scene: this.vorticityProgram,
      target: this.velocity.write,
      sort: false,
      update: false,
    })

    this.velocity.swap()

    this.divergenceProgram.program.uniforms.uVelocity.value = this.velocity.read.texture

    this.renderer.render({
      scene: this.divergenceProgram,
      target: this.divergence,
      sort: false,
      update: false,
    })

    this.clearProgram.program.uniforms.uTexture.value = this.pressure.read.texture

    this.renderer.render({
      scene: this.clearProgram,
      target: this.pressure.write,
      sort: false,
      update: false,
    })

    this.pressure.swap()

    this.pressureProgram.program.uniforms.uDivergence.value = this.divergence.texture

    for (let i = 0; i < ITERATIONS; i++) {
      this.pressureProgram.program.uniforms.uPressure.value = this.pressure.read.texture

      this.renderer.render({
        scene: this.pressureProgram,
        target: this.pressure.write,
        sort: false,
        update: false,
      })

      this.pressure.swap()
    }

    this.gradientSubtractProgram.program.uniforms.uPressure.value = this.pressure.read.texture
    this.gradientSubtractProgram.program.uniforms.uVelocity.value = this.velocity.read.texture

    this.renderer.render({
      scene: this.gradientSubtractProgram,
      target: this.velocity.write,
      sort: false,
      update: false,
    })

    this.velocity.swap()

    this.advectionProgram.program.uniforms.dyeTexelSize.value.set(1 / SIMULATION_RESOLUTION)
    this.advectionProgram.program.uniforms.uVelocity.value = this.velocity.read.texture
    this.advectionProgram.program.uniforms.uSource.value = this.velocity.read.texture
    this.advectionProgram.program.uniforms.dissipation.value = velocityDissipation

    this.renderer.render({
      scene: this.advectionProgram,
      target: this.velocity.write,
      sort: false,
      update: false,
    })

    this.velocity.swap()

    this.advectionProgram.program.uniforms.dyeTexelSize.value.set(1 / DYE_RESOLUTION)
    this.advectionProgram.program.uniforms.uVelocity.value = this.velocity.read.texture
    this.advectionProgram.program.uniforms.uSource.value = this.density.read.texture
    this.advectionProgram.program.uniforms.dissipation.value = densityDissipation

    this.renderer.render({
      scene: this.advectionProgram,
      target: this.density.write,
      sort: false,
      update: false,
    })

    this.density.swap()

    // Set clear back to default
    this.renderer.autoClear = true

    // Update post pass uniform with the simulation output
    this.pass.uniforms.tFluid.value = this.density.read.texture

    this.post.render({
      camera: this.camera,
      scene: this.scene,
    })

    this.scene.onLoop(this.lenis.scroll)

    window.requestAnimationFrame(this.onLoop.bind(this))
  }

  onResize() {
    const { innerHeight: height, innerWidth: width } = window

    this.renderer.setSize(width, height)

    this.camera.perspective({
      aspect: width / height,
    })

    const fov = this.camera.fov * (Math.PI / 180)
    const sceneHeight = 2 * Math.tan(fov / 2) * this.camera.position.z
    const sceneWidth = sceneHeight * this.camera.aspect

    this.sizes = new Vec2(sceneWidth, sceneHeight)
    this.viewport = new Vec2(width, height)

    this.post.resize()

    this.scene.onResize()
  }
}

// Initialize Canvas with debug logging
// console.log('Starting Canvas initialization...')
new Canvas()
// console.log('Canvas instance created')
