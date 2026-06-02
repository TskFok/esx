import { useEffect, useState } from "react";
import { parseTagsInput } from "../../lib/request-tags";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { Input } from "../ui/input";

export type ConsoleBulkTagsDialogProps = {
  open: boolean;
  selectedCount: number;
  onClose: () => void;
  onApply: (payload: { add: string[]; remove: string[] }) => void;
};

export function ConsoleBulkTagsDialog({ open, selectedCount, onClose, onApply }: ConsoleBulkTagsDialogProps) {
  const [addTagsInput, setAddTagsInput] = useState("");
  const [removeTagsInput, setRemoveTagsInput] = useState("");

  useEffect(() => {
    if (!open) {
      setAddTagsInput("");
      setRemoveTagsInput("");
    }
  }, [open]);

  const addTags = parseTagsInput(addTagsInput);
  const removeTags = parseTagsInput(removeTagsInput);
  const canApply = addTags.length > 0 || removeTags.length > 0;

  return (
    <Dialog
      open={open}
      title="批量编辑标签"
      description={`已选择 ${selectedCount} 条请求。可追加标签，也可移除已有标签。`}
      onClose={onClose}
      onConfirm={() => onApply({ add: addTags, remove: removeTags })}
      confirmDisabled={!canApply}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button onClick={() => onApply({ add: addTags, remove: removeTags })} disabled={!canApply}>
            应用
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">追加标签</span>
          <Input
            placeholder="例如 巡检，排障"
            value={addTagsInput}
            onChange={(event) => setAddTagsInput(event.target.value)}
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-slate-700">移除标签</span>
          <Input
            placeholder="输入要移除的标签，多个用逗号分隔"
            value={removeTagsInput}
            onChange={(event) => setRemoveTagsInput(event.target.value)}
          />
        </label>
      </div>
    </Dialog>
  );
}
