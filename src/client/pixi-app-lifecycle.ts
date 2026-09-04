type PartiallyInitializedPixiApplication = { stop?: () => void };

/** React StrictMode may dispose an Application before Pixi installs stop(). */
export function stopPixiApplication(app: PartiallyInitializedPixiApplication): void {
  if (typeof app.stop === "function") app.stop();
}
