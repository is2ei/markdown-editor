/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React from 'react';
import { Editor, getEventTransfer } from 'slate-react';
import { Value } from 'slate';
import baseSchema from './schema';
import { FromHTML } from './html/fromHTML';
import PropTypes from 'prop-types';
import { Markdown } from './markdown';

const defaultMarkdown = `# Heading One
This is text. This is *italic* text. This is **bold** text. This is a [link](https://clause.io). This is \`inline code\`.

This is ***bold and italic*** text

> This is a quote.
## Heading Two
This is more text.`;

/**
 * A plugin based rich-text editor that uses Common Mark for serialization.
 * The default markdown to be edited in passed in the 'markdown' property
 * while the plugins are passed in the 'plugins' property.
 *
 * Plugins are responsible for serialization to/from markdown and HTML,
 * rendering and schema definition.
 */
class MarkdownEditor extends React.Component {
  constructor(props) {
    super(props);
    this.state = { value: Value.fromJSON({ document: { nodes: [] } }),
      markdown: props.markdown ? props.markdown : defaultMarkdown };
    this.editor = null;
    this.markdown = new Markdown();
    this.fromHTML = new FromHTML();

    this.handleOnChange = this.onChange.bind(this);
    this.handleOnKeyDown = this.onKeyDown.bind(this);
    this.handleOnPaste = this.onPaste.bind(this);
    this.handleRenderNode = this.renderNode.bind(this);
    this.handleRenderMark = this.renderMark.bind(this);
    this.handleRenderEditor = this.renderEditor.bind(this);
    this.handleGetPlugin = this.getPlugin.bind(this);

    this.schema = baseSchema;
    this.props.plugins.forEach((plugin) => {
      plugin.tags.forEach((tag) => {
        this.schema.document.nodes[0].match.push({ type: tag });
      });
    });
  }

  componentDidMount() {
    this.state.value = this.markdown.fromMarkdown.convert(this.editor, this.state.markdown);
  }

  onInit(editor, props, next) {
    this.editor = editor;
    this.editor.getPlugin = this.handleGetPlugin;
    this.editor.helpers = {
      markdown: {
        toMarkdown: this.markdown.toMarkdown.recursive.bind(this.markdown.toMarkdown),
      },
    };

    return next();
  }

  // On change, update the app's React state with the new editor value.
  onChange({ value }) {
    this.setState({ value });

    if (this.isMarkdownEditorFocused()) {
      const markdown = this.markdown.toMarkdown.convert(this.editor, value);
      this.setState({ markdown });
    }
  }

  onMarkdownChange(event) {
    this.setState({ markdown: event.target.value });
    const value = this.markdown.fromMarkdown.convert(this.editor, event.target.value);
    this.setState({ value });
  }

  /**
   * On space, if it was after an auto-markdown shortcut, convert the current
   * node into the shortcut's corresponding type.
   *
   * @param {Event} event
   * @param {Editor} editor
   * @param {Function} next
   */

  onSpace(event, editor, next) {
    const { value } = editor;
    const { selection } = value;
    if (selection.isExpanded) return next();

    const { startBlock } = value;
    const { start } = selection;
    const chars = startBlock.text.slice(0, start.offset).replace(/\s*/g, '');
    const type = this.getType(chars);
    if (!type) return next();
    if (type === 'list_item' && startBlock.type === 'list_item') return next();
    if (type === 'horizontal_rule') {
      const hr = {
        type: 'horizontal_rule',
      };
      editor.insertBlock(hr);
      // this CRASHES? editor.moveFocusToEndOfNode(hr);
    }

    event.preventDefault();
    editor.setBlocks(type);

    if (type === 'list_item') {
      // TODO (DCS) what about ol?
      editor.wrapBlock('ul_list');
    }

    editor.moveFocusToStartOfNode(startBlock).delete();
    return undefined;
  }

  /**
   * On backspace, if at the start of a non-paragraph, convert it back into a
   * paragraph node.
   *
   * @param {Event} event
   * @param {Editor} editor
   * @param {Function} next
   */

  onBackspace(event, editor, next) {
    const { value } = editor;
    const { selection } = value;
    if (selection.isExpanded) return next();
    if (selection.start.offset !== 0) return next();

    const { startBlock } = value;
    if (startBlock.type === 'paragraph') return next();

    event.preventDefault();
    editor.setBlocks('paragraph');

    if (startBlock.type === 'list_item') {
      editor.unwrapBlock('list');
    }

    return undefined;
  }

  /**
   * On return, if at the end of a node type that should not be extended,
   * create a new paragraph below it.
   *
   * @param {Event} event
   * @param {Editor} editor
   * @param {Function} next
   */

  onEnter(event, editor, next) {
    // console.log(editor);
    // console.log('onEnter of index.js');
    // const { value } = editor;
    const { value } = editor;
    const { selection } = value;
    const { start, end, isExpanded } = selection;

    if (isExpanded) return next();

    const { startBlock } = value;
    if (start.offset === 0 && startBlock.text.length === 0) {
      return this.onBackspace(event, editor, next);
    }

    if (end.offset !== startBlock.text.length) return next();

    // if you hit enter inside anything that is not a heading
    // we use the default behavior
    if (!startBlock.type.startsWith('heading')) {
      return next();
    }

    // when you hit enter after a heading we insert a paragraph
    event.preventDefault();
    editor.splitBlock(0).setBlocks('paragraph');
    return next();
  }

  onKeyDown(event, editor, next) {
    switch (event.key) {
      /* case ' ':
        return this.onSpace(event, editor, next);
      case 'Backspace':
        return this.onBackspace(event, editor, next);
      case "Enter":
        return this.onEnter(event, editor, next); */
      default:
        return next();
    }
  }

  onPaste(event, editor, next) {
    const transfer = getEventTransfer(event);
    if (transfer.type !== 'html') return next();
    const { document } = this.fromHTML.convert(this.editor, transfer.html);
    editor.insertFragment(document);
    return undefined;
  }

  getPlugin(plugin, by_key = 'plugin', in_array = false) {
    for (const p of this.props.plugins) {
      if (in_array) {
        if (p[by_key].includes(plugin)) {
          return p;
        }
      } else if (p[by_key] === plugin) {
        return p;
      }
    }
    return null;
  }

  /**
   * Get the block type for a series of auto-markdown shortcut `chars`.
   *
   * @param {String} chars
   * @return {String} block
   */

  getType(chars) {
    switch (chars) {
      case '*':
      case '-':
      case '+':
        return 'list_item';
      case '>':
        return 'block_quote';
      case '#':
        return 'heading_one';
      case '##':
        return 'heading_two';
      case '###':
        return 'heading_three';
      case '####':
        return 'heading_four';
      case '#####':
        return 'heading_five';
      case '######':
        return 'heading_six';
      case '---':
        return 'horizontal_rule';
      default:
        return null;
    }
  }

  isMarkdownEditorFocused() {
    return document.activeElement.getAttribute('data-slate-editor');
  }

  renderNode(props, editor, next) {
    const { node, attributes, children } = props;

    switch (node.type) {
      case 'paragraph':
        return <p {...attributes}>{children}</p>;
      case 'heading_one':
        return <h1 {...attributes}>{children}</h1>;
      case 'heading_two':
        return <h2 {...attributes}>{children}</h2>;
      case 'heading_three':
        return <h3 {...attributes}>{children}</h3>;
      case 'heading_four':
        return <h4 {...attributes}>{children}</h4>;
      case 'heading_five':
        return <h5 {...attributes}>{children}</h5>;
      case 'heading_six':
        return <h6 {...attributes}>{children}</h6>;
      case 'horizontal_rule':
        return <hr {...attributes} />;
      case 'block_quote':
        return <blockquote {...attributes}>{children}</blockquote>;
      case 'code_block':
        return <pre {...attributes}>{children}</pre>;
      case 'html_block':
        return <pre {...attributes}>{children}</pre>;
      case 'link': {
        const { data } = node;
        const href = data.get('href');
        return <a {...attributes} href={href}>{children}</a>;
      }
      default:
        return next();
    }
  }

  /**
   * Render a Slate mark.
   *
   * @param {Object} props
   * @param {Editor} editor
   * @param {Function} next
   * @return {Element}
   */

  renderMark(props, editor, next) {
    const { children, mark, attributes } = props;

    switch (mark.type) {
      case 'bold':
        return <strong {...attributes}>{children}</strong>;
      case 'italic':
        return <em {...attributes}>{children}</em>;
      case 'html':
      case 'code':
        return <code {...attributes}>{children}</code>;
      default:
        return next();
    }
  }

  renderEditor(props, editor, next) {
    if (!this.__init && typeof this.onInit === 'function') {
      this.__init = true;
      return this.onInit(props, editor, next);
    }
    return next();
  }

  // Render the editor.
  render() {
    return (
      <div className="doc">
        <Editor
          className="doc-inner"
          value={this.state.value}
          schema={this.schema}
          plugins={this.props.plugins}
          onChange={this.handleOnChange}
          onKeyDown={this.handleOnKeyDown}
          onPaste={this.handleOnPaste}
          renderNode={this.handleRenderNode}
          renderMark={this.handleRenderMark}
          renderEditor={this.handleRenderEditor}
        />
        <div className="doc-inner">
          <textarea className="markdown-box" value={this.state.markdown} onChange={event => this.onMarkdownChange(event)} />
        </div>
      </div>
    );
  }
}

MarkdownEditor.propTypes = {
  markdown: PropTypes.string,
  plugins: PropTypes.arrayOf(PropTypes.shape({
    onEnter: PropTypes.func,
    onKeyDown: PropTypes.func,
    renderNode: PropTypes.func.isRequired,
    toMarkdown: PropTypes.func.isRequired,
    fromMarkdown: PropTypes.func.isRequired,
    fromHTML: PropTypes.func.isRequired,
    plugin: PropTypes.string.isRequired,
    tags: PropTypes.arrayOf(PropTypes.string).isRequired,
    markdownTags: PropTypes.arrayOf(PropTypes.string).isRequired,
    schema: PropTypes.object.isRequired,
  })),
};

export { MarkdownEditor };
