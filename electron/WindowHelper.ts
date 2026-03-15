import { BrowserWindow, screen, app } from "electron"
import { AppState } from "./main"
import path from "node:path"

const isEnvDev = process.env.NODE_ENV === "development"
const isPackaged = app.isPackaged
const inAppBundle = process.execPath.includes(".app/") || process.execPath.includes(".app\\")

console.log(`[WindowHelper] isEnvDev: ${isEnvDev}, isPackaged: ${isPackaged}, inAppBundle: ${inAppBundle}`)

const isDev = isEnvDev && !isPackaged

const startUrl = isDev
  ? "http://localhost:5180"
  : `file://${path.join(__dirname, "../dist/index.html")}`

export class WindowHelper {
  private launcherWindow: BrowserWindow | null = null
  private overlayWindow: BrowserWindow | null = null
  private isWindowVisible: boolean = false
  private contentProtectionEnabled: boolean = false

  private launcherPosition: { x: number; y: number } | null = null
  private launcherSize: { width: number; height: number } | null = null
  private currentWindowMode: "launcher" | "overlay" = "launcher"

  private appState: AppState

  private screenWidth: number = 0
  private screenHeight: number = 0

  private step: number = 20
  private currentX: number = 0
  private currentY: number = 0

  constructor(appState: AppState) {
    this.appState = appState
  }

  private syncVisibilityState(): void {
    const launcherVisible = !!(this.launcherWindow && !this.launcherWindow.isDestroyed() && this.launcherWindow.isVisible())
    const overlayVisible = !!(this.overlayWindow && !this.overlayWindow.isDestroyed() && this.overlayWindow.isVisible())
    this.isWindowVisible = launcherVisible || overlayVisible
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
  }

  private getOverlayWorkArea(): Electron.Rectangle {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      return screen.getDisplayMatching(this.overlayWindow.getBounds()).workArea
    }
    return screen.getPrimaryDisplay().workArea
  }

  private keepOverlayInWorkArea(): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return

    const bounds = this.overlayWindow.getBounds()
    const workArea = this.getOverlayWorkArea()
    const maxX = workArea.x + Math.max(0, workArea.width - bounds.width)
    const maxY = workArea.y + Math.max(0, workArea.height - bounds.height)
    const nextX = this.clamp(bounds.x, workArea.x, maxX)
    const nextY = this.clamp(bounds.y, workArea.y, maxY)

    if (nextX !== bounds.x || nextY !== bounds.y) {
      this.overlayWindow.setPosition(nextX, nextY)
    }
  }

  private applyContentProtectionToWindow(win: BrowserWindow | null): void {
    if (!win || win.isDestroyed()) return

    win.setContentProtection(this.contentProtectionEnabled)

    if (this.contentProtectionEnabled && win.isVisible()) {
      setTimeout(() => {
        if (!win.isDestroyed()) {
          win.setContentProtection(true)
        }
      }, 75)
    }
  }

  private ensureOverlayAlwaysOnTop(): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return

    if (process.platform === "darwin") {
      this.overlayWindow.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      })
      this.overlayWindow.setHiddenInMissionControl(true)
      this.overlayWindow.setAlwaysOnTop(true, "screen-saver")
    } else if (process.platform === "win32") {
      this.overlayWindow.setAlwaysOnTop(true, "screen-saver")
    } else {
      this.overlayWindow.setAlwaysOnTop(true)
    }

    this.overlayWindow.moveTop()
  }

  private revealOverlayWindow(): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return

    this.applyContentProtectionToWindow(this.overlayWindow)
    this.ensureOverlayAlwaysOnTop()
    this.keepOverlayInWorkArea()

    if (process.platform === "darwin") {
      app.focus({ steal: true })
    }

    this.overlayWindow.show()
    this.overlayWindow.moveTop()
    this.overlayWindow.focus()

    if (this.launcherWindow && !this.launcherWindow.isDestroyed()) {
      this.launcherWindow.hide()
    }

    this.currentWindowMode = "overlay"
    this.syncVisibilityState()
  }

  public setContentProtection(enable: boolean): void {
    this.contentProtectionEnabled = enable
    this.applyContentProtectionToWindow(this.launcherWindow)
    this.applyContentProtectionToWindow(this.overlayWindow)
    console.log(`[WindowHelper] Content Protection set to: ${enable}`)
  }

  public setWindowDimensions(width: number, height: number): void {
    const activeWindow = this.getMainWindow()
    if (!activeWindow || activeWindow.isDestroyed()) return

    const [currentX, currentY] = activeWindow.getPosition()
    const workArea = screen.getDisplayMatching(activeWindow.getBounds()).workArea
    const maxAllowedWidth = Math.floor(workArea.width * 0.9)
    const newWidth = Math.min(width, maxAllowedWidth)
    const newHeight = Math.ceil(height)
    const maxX = workArea.x + workArea.width - newWidth
    const newX = this.clamp(currentX, workArea.x, maxX)

    activeWindow.setBounds({
      x: newX,
      y: currentY,
      width: newWidth,
      height: newHeight,
    })

    if (activeWindow === this.launcherWindow) {
      this.launcherSize = { width: newWidth, height: newHeight }
      this.launcherPosition = { x: newX, y: currentY }
    }
  }

  public setOverlayDimensions(width: number, height: number): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return
    console.log("[WindowHelper] setOverlayDimensions:", width, height)

    const [currentX, currentY] = this.overlayWindow.getPosition()
    const workArea = this.getOverlayWorkArea()
    const maxAllowedWidth = Math.floor(workArea.width * 0.9)
    const maxAllowedHeight = Math.floor(workArea.height * 0.9)
    const newWidth = Math.min(Math.max(width, 300), maxAllowedWidth)
    const newHeight = Math.min(Math.max(height, 1), maxAllowedHeight)
    const maxX = workArea.x + workArea.width - newWidth
    const maxY = workArea.y + workArea.height - newHeight
    const newX = this.clamp(currentX, workArea.x, maxX)
    const newY = this.clamp(currentY, workArea.y, maxY)

    this.overlayWindow.setBounds({
      x: Math.round(newX),
      y: Math.round(newY),
      width: Math.round(newWidth),
      height: Math.round(newHeight),
    })
  }

  public createWindow(): void {
    if (this.launcherWindow !== null) return

    const primaryDisplay = screen.getPrimaryDisplay()
    const workArea = primaryDisplay.workArea
    this.screenWidth = workArea.width
    this.screenHeight = workArea.height

    const width = 1200
    const height = 800
    const x = Math.round(workArea.x + (workArea.width - width) / 2)
    const topMargin = Math.round(workArea.height * 0.05)
    const y = Math.round(workArea.y + topMargin)

    const launcherSettings: Electron.BrowserWindowConstructorOptions = {
      width,
      height,
      x,
      y,
      minWidth: 600,
      minHeight: 400,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "preload.js"),
        scrollBounce: true,
        webSecurity: !isDev,
      },
      show: false,
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 14, y: 14 },
      vibrancy: "under-window",
      visualEffectState: "followWindow",
      transparent: false,
      hasShadow: true,
      backgroundColor: "#000000",
      focusable: true,
      resizable: true,
      movable: true,
      center: true,
      icon: app.isPackaged
        ? path.join(process.resourcesPath, "natively.icns")
        : path.resolve(__dirname, "../assets/natively.icns"),
    }

    console.log(`[WindowHelper] Icon Path: ${launcherSettings.icon}`)
    console.log(`[WindowHelper] Start URL: ${startUrl}`)

    try {
      this.launcherWindow = new BrowserWindow(launcherSettings)
      console.log("[WindowHelper] BrowserWindow created successfully")
    } catch (err) {
      console.error("[WindowHelper] Failed to create BrowserWindow:", err)
      return
    }

    this.applyContentProtectionToWindow(this.launcherWindow)

    this.launcherWindow
      .loadURL(`${startUrl}?window=launcher`)
      .then(() => console.log("[WindowHelper] loadURL success"))
      .catch((e) => {
        console.error("[WindowHelper] Failed to load URL:", e)
      })

    this.launcherWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
      console.error(`[WindowHelper] did-fail-load: ${errorCode} ${errorDescription}`)
    })

    const overlaySettings: Electron.BrowserWindowConstructorOptions = {
      width: 600,
      height: 1,
      minWidth: 300,
      minHeight: 1,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "preload.js"),
        scrollBounce: true,
      },
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      alwaysOnTop: true,
      fullscreenable: false,
      focusable: true,
      resizable: false,
      movable: true,
      skipTaskbar: true,
      hasShadow: false,
    }

    this.overlayWindow = new BrowserWindow(overlaySettings)
    this.applyContentProtectionToWindow(this.overlayWindow)
    this.ensureOverlayAlwaysOnTop()
    this.overlayWindow.loadURL(`${startUrl}?window=overlay`).catch(() => {})

    this.launcherWindow.once("ready-to-show", () => {
      this.launcherWindow?.show()
      this.launcherWindow?.focus()
      this.isWindowVisible = true
    })

    this.setupWindowListeners()
  }

  private setupWindowListeners(): void {
    if (!this.launcherWindow) return

    this.launcherWindow.on("move", () => {
      if (!this.launcherWindow) return
      const bounds = this.launcherWindow.getBounds()
      this.launcherPosition = { x: bounds.x, y: bounds.y }
      this.appState.settingsWindowHelper.reposition(bounds)
    })

    this.launcherWindow.on("resize", () => {
      if (!this.launcherWindow) return
      const bounds = this.launcherWindow.getBounds()
      this.launcherSize = { width: bounds.width, height: bounds.height }
      this.appState.settingsWindowHelper.reposition(bounds)
    })

    this.launcherWindow.on("show", () => {
      this.applyContentProtectionToWindow(this.launcherWindow)
      this.syncVisibilityState()
    })

    this.launcherWindow.on("hide", () => {
      this.syncVisibilityState()
    })

    this.launcherWindow.on("closed", () => {
      this.launcherWindow = null
      if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
        this.overlayWindow.close()
      }
      this.overlayWindow = null
      this.isWindowVisible = false
    })

    if (!this.overlayWindow) return

    this.overlayWindow.on("show", () => {
      this.applyContentProtectionToWindow(this.overlayWindow)
      this.ensureOverlayAlwaysOnTop()
      this.keepOverlayInWorkArea()
      this.syncVisibilityState()
    })

    this.overlayWindow.on("hide", () => {
      this.syncVisibilityState()
    })

    this.overlayWindow.on("focus", () => {
      this.ensureOverlayAlwaysOnTop()
    })

    this.overlayWindow.on("blur", () => {
      setTimeout(() => {
        this.ensureOverlayAlwaysOnTop()
      }, 50)
    })

    this.overlayWindow.on("close", (e) => {
      if (this.isWindowVisible && this.overlayWindow?.isVisible()) {
        e.preventDefault()
        this.switchToLauncher()
      }
    })
  }

  public getMainWindow(): BrowserWindow | null {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed() && this.overlayWindow.isVisible()) {
      return this.overlayWindow
    }
    return this.launcherWindow
  }

  public getLauncherWindow(): BrowserWindow | null {
    return this.launcherWindow
  }

  public getOverlayWindow(): BrowserWindow | null {
    return this.overlayWindow
  }

  public getCurrentWindowMode(): "launcher" | "overlay" {
    return this.currentWindowMode
  }

  public isVisible(): boolean {
    return this.isWindowVisible
  }

  public hideMainWindow(): void {
    this.launcherWindow?.hide()
    this.overlayWindow?.hide()
    this.isWindowVisible = false
  }

  public showMainWindow(): void {
    if (this.currentWindowMode === "overlay") {
      this.switchToOverlay()
    } else {
      this.switchToLauncher()
    }
  }

  public toggleMainWindow(): void {
    this.syncVisibilityState()

    if (this.currentWindowMode === "overlay") {
      this.revealOverlayWindow()
      return
    }

    if (this.isWindowVisible) {
      this.hideMainWindow()
    } else {
      this.showMainWindow()
    }
  }

  public toggleOverlayWindow(): void {
    this.toggleMainWindow()
  }

  public centerAndShowWindow(): void {
    this.switchToLauncher()
    this.launcherWindow?.center()
  }

  public switchToOverlay(): void {
    if (!this.overlayWindow || this.overlayWindow.isDestroyed()) return
    console.log("[WindowHelper] Switching to OVERLAY")
    this.currentWindowMode = "overlay"

    const shouldResetBounds = !this.overlayWindow.isVisible()
    if (shouldResetBounds) {
      const targetDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      const workArea = targetDisplay.workArea
      const width = 600
      const height = 216
      const x = workArea.x + Math.floor((workArea.width - width) / 2)
      const y = workArea.y + Math.floor((workArea.height - height) / 2)
      this.overlayWindow.setBounds({ x, y, width, height })
    } else {
      this.keepOverlayInWorkArea()
    }

    this.revealOverlayWindow()
  }

  public switchToLauncher(): void {
    console.log("[WindowHelper] Switching to LAUNCHER")
    this.currentWindowMode = "launcher"

    if (this.launcherWindow && !this.launcherWindow.isDestroyed()) {
      this.applyContentProtectionToWindow(this.launcherWindow)
      this.launcherWindow.show()
      this.applyContentProtectionToWindow(this.launcherWindow)
      this.launcherWindow.focus()
      this.isWindowVisible = true
    }

    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.hide()
    }

    this.syncVisibilityState()
  }

  public setWindowMode(mode: "launcher" | "overlay"): void {
    if (mode === "launcher") {
      this.switchToLauncher()
    } else {
      this.switchToOverlay()
    }
  }

  private moveActiveWindow(dx: number, dy: number): void {
    const win = this.getMainWindow()
    if (!win || win.isDestroyed()) return

    const [x, y] = win.getPosition()
    win.setPosition(x + dx, y + dy)

    if (win === this.overlayWindow) {
      this.keepOverlayInWorkArea()
    }

    this.currentX = x + dx
    this.currentY = y + dy
  }

  public moveWindowRight(): void {
    this.moveActiveWindow(this.step, 0)
  }

  public moveWindowLeft(): void {
    this.moveActiveWindow(-this.step, 0)
  }

  public moveWindowDown(): void {
    this.moveActiveWindow(0, this.step)
  }

  public moveWindowUp(): void {
    this.moveActiveWindow(0, -this.step)
  }
}
