"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import { useEffect, useState } from "react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  List,
  ListOrdered,
  Link as LinkIcon,
  Undo,
  Redo,
  Code,
  Heading2,
  Heading3,
  Quote,
} from "lucide-react";

function ToolbarButton({ onClick, active, disabled, children, title }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded-md transition-colors ${
        active
          ? "bg-amber-100 text-amber-800"
          : "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
      } disabled:opacity-30`}
    >
      {children}
    </button>
  );
}

export default function RichEditor({ value, onChange, placeholder, minHeight = "200px" }) {
  const [showSource, setShowSource] = useState(false);
  const [sourceValue, setSourceValue] = useState("");

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { target: "_blank", rel: "noopener" },
      }),
      Underline,
    ],
    content: value || "",
    onUpdate({ editor }) {
      const html = editor.getHTML();
      // TipTap returns <p></p> for empty, normalize to empty string
      onChange(html === "<p></p>" ? "" : html);
    },
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none min-h-[inherit] px-3 py-2",
        style: `min-height: ${minHeight}`,
      },
    },
  });

  // Sync external value changes (e.g. language switch)
  useEffect(() => {
    if (!editor) return;
    if (showSource) {
      // De textarea schrijft in bron-modus zelf naar value, dus die twee lopen
      // alleen uiteen als er van buitenaf nieuwe inhoud is geladen (andere taal,
      // gekozen template). Dan moet de buffer mee: anders schrijven we bij het
      // terugschakelen de oude HTML over die nieuwe inhoud heen.
      setSourceValue((current) => ((value || "") === current ? current : value || ""));
      return;
    }
    const current = editor.getHTML();
    const normalized = current === "<p></p>" ? "" : current;
    if (normalized !== (value || "")) {
      editor.commands.setContent(value || "");
    }
  }, [value, editor, showSource]);

  if (!editor) return null;

  function addLink() {
    const url = window.prompt("URL:", editor.getAttributes("link").href || "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    }
  }

  function toggleSourceView() {
    if (!showSource) {
      // WYSIWYG -> HTML bron
      const current = editor.getHTML();
      const normalized = current === "<p></p>" ? "" : current;
      setSourceValue(normalized);
      setShowSource(true);
    } else {
      // HTML bron -> WYSIWYG
      const html = sourceValue || "";
      editor.commands.setContent(html);
      onChange(html === "<p></p>" ? "" : html);
      setShowSource(false);
    }
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden focus-within:border-amber-500 focus-within:ring-1 focus-within:ring-amber-200">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 bg-gray-50 border-b border-gray-200">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          disabled={showSource}
          title="Vet"
        >
          <Bold className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          disabled={showSource}
          title="Cursief"
        >
          <Italic className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive("underline")}
          disabled={showSource}
          title="Onderstrepen"
        >
          <UnderlineIcon className="w-4 h-4" />
        </ToolbarButton>

        <div className="w-px h-5 bg-gray-200 mx-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive("heading", { level: 2 })}
          disabled={showSource}
          title="Kop 2"
        >
          <Heading2 className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive("heading", { level: 3 })}
          disabled={showSource}
          title="Kop 3"
        >
          <Heading3 className="w-4 h-4" />
        </ToolbarButton>

        <div className="w-px h-5 bg-gray-200 mx-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          disabled={showSource}
          title="Opsomming"
        >
          <List className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
          disabled={showSource}
          title="Genummerde lijst"
        >
          <ListOrdered className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive("blockquote")}
          disabled={showSource}
          title="Citaat"
        >
          <Quote className="w-4 h-4" />
        </ToolbarButton>

        <div className="w-px h-5 bg-gray-200 mx-1" />

        <ToolbarButton
          onClick={addLink}
          active={editor.isActive("link")}
          disabled={showSource}
          title="Link"
        >
          <LinkIcon className="w-4 h-4" />
        </ToolbarButton>

        <div className="w-px h-5 bg-gray-200 mx-1" />

        <ToolbarButton
          onClick={toggleSourceView}
          active={showSource}
          title={showSource ? "Terug naar visuele editor" : "HTML bron tonen/bewerken"}
        >
          <Code className="w-4 h-4" />
        </ToolbarButton>

        <div className="flex-1" />

        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={showSource || !editor.can().undo()}
          title="Ongedaan maken"
        >
          <Undo className="w-4 h-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={showSource || !editor.can().redo()}
          title="Opnieuw"
        >
          <Redo className="w-4 h-4" />
        </ToolbarButton>
      </div>

      {/* Editor / HTML bron */}
      {showSource ? (
        <textarea
          value={sourceValue}
          onChange={(e) => {
            setSourceValue(e.target.value);
            onChange(e.target.value);
          }}
          spellCheck={false}
          className="w-full font-mono text-xs px-3 py-2 outline-none resize-y bg-white text-gray-800 block"
          style={{ minHeight }}
        />
      ) : (
        <EditorContent editor={editor} />
      )}
    </div>
  );
}
