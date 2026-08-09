/**
 * Undoes `remark-math` inline matches that are almost certainly not math.
 *
 * `remark-math` happily reads the text between any two dollar signs, so a line
 * like `价格 $100 和 $200` turns into an inline formula holding "100 和 ".
 * Real inline math never has whitespace hugging its delimiters, which is the
 * same rule Pandoc uses, so nodes whose value starts or ends with whitespace
 * are turned back into the literal source text.
 */

type MdastNode = {
  type: string;
  value?: string;
  children?: MdastNode[];
};

function restoreLiteralMath(node: MdastNode): void {
  if (!node.children) {
    return;
  }

  for (const child of node.children) {
    if (child.type === "inlineMath" && /^\s|\s$/.test(child.value ?? "")) {
      child.type = "text";
      child.value = `$${child.value ?? ""}$`;
      continue;
    }

    restoreLiteralMath(child);
  }
}

export function remarkGuardInlineMath() {
  return (tree: MdastNode) => {
    restoreLiteralMath(tree);
  };
}
