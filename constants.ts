/**
 * Shared frontend constants — global string literals used across components
 * and islands. Keep cross-cutting magic strings here rather than scattered
 * next to one of their call sites.
 */

// dataTransfer MIME type carrying a project-relative file path when dragging
// a project file (e.g. an explorer image into the composer, or a generated
// video onto a folder).
export const PROJECT_FILE_MIME = "application/x-project-file";

// dataTransfer MIME set (in addition to PROJECT_FILE_MIME) when the drag
// originates from a generated video in the results grid. The explorer uses it
// to tell a grid video apart from an explorer file, so it can prompt for a
// name before saving the copy.
export const GENERATION_VIDEO_MIME = "application/x-generation-video";
