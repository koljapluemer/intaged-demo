import CodeBlock, { type CodeBlockOptions } from '@tiptap/extension-code-block'
import { VueNodeViewRenderer } from '@tiptap/vue-3'
import CodeBlockView from './CodeBlockView.vue'

export const INTAGED_LANGUAGE = 'intaged'

export interface CodeBlockWithWidgetsOptions extends CodeBlockOptions {
  /** Name of the document being edited; used to key cached widgets per block. */
  docName: string
}

// Plain CodeBlock (Markdown fences, input rules, keys all built in) whose node view
// renders ```intaged blocks as AI-generated widgets.
export const CodeBlockWithWidgets = CodeBlock.extend<CodeBlockWithWidgetsOptions>({
  addOptions() {
    return { ...this.parent!(), docName: '' }
  },

  addNodeView() {
    return VueNodeViewRenderer(CodeBlockView)
  },
})
