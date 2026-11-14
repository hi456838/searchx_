// The current selection is preserved while search is open; it resumes on dismissal.
export function uiState({searchOpen, inspectorOpen, lessonOpen}) {
  if (searchOpen) return 'search';
  if (inspectorOpen || lessonOpen) return 'investigate';
  return 'explore';
}
