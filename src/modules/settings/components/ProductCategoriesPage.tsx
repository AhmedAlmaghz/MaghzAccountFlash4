import React, { useState } from 'react';
import { FolderTree, Plus, Pencil, Trash2, ChevronRight, ChevronDown, CheckSquare } from 'lucide-react';
import { Card, Button, Modal, Input, ConfirmDialog, Can } from '@/core/ui/components';
import { useProductCategories } from '@/modules/inventory/hooks/useInventory';
import { useAppStore } from '@/core/store';
import { useTranslation } from '@/core/i18n/useTranslation';
import { useToastStore } from '@/core/store/toastStore';

interface CategoryNode {
  id: string;
  name: string;
  parentId?: string;
  children: CategoryNode[];
}

function buildTree(categories: { id: string; name: string; parentId?: string | null }[]): CategoryNode[] {
  const map: Record<string, CategoryNode> = {};
  const roots: CategoryNode[] = [];
  categories.forEach(c => {
    map[c.id] = { id: c.id, name: c.name, parentId: c.parentId || undefined, children: [] };
  });
  categories.forEach(c => {
    if (c.parentId && map[c.parentId]) {
      map[c.parentId].children.push(map[c.id]);
    } else {
      roots.push(map[c.id]);
    }
  });
  return roots;
}

function TreeNode({ node, level, onEdit, onDelete, t }: { node: CategoryNode; level: number; onEdit: (n: CategoryNode) => void; onDelete: (id: string) => void; t: (key: string) => string }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div>
      <div className={`flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 ${level > 0 ? 'mr-6 border-r border-slate-200 dark:border-slate-700' : ''}`}>
        {node.children.length > 0 && (
          <button onClick={() => setExpanded(!expanded)} className="text-slate-400 hover:text-slate-600">
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        )}
        <FolderTree size={16} className="text-amber-500" />
        <span className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-100">{node.name}</span>
        <span className="text-xs text-slate-400">{node.children.length} {t('settings.productCategories.subcategories')}</span>
        <Can action="edit" module="settings"><Button size="sm" variant="ghost" onClick={() => onEdit(node)} leftIcon={<Pencil size={12} />} /></Can>
        <Can action="delete" module="settings"><Button size="sm" variant="ghost" onClick={() => onDelete(node.id)} leftIcon={<Trash2 size={12} className="text-rose-500" />} /></Can>
      </div>
      {expanded && node.children.length > 0 && (
        <div className="mr-3">
          {node.children.map(child => (
            <TreeNode key={child.id} node={child} level={level + 1} onEdit={onEdit} onDelete={onDelete} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

export const ProductCategoriesPage: React.FC = () => {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const activeCompany = useAppStore(state => state.activeCompany);
  const { categories, isLoading, create, update, remove } = useProductCategories(activeCompany?.id || '');
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', parentId: '' });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  const tree = buildTree(categories);

  const handleSave = async () => {
    if (!form.name || !activeCompany?.id) {
      addToast('error', t('settings.productCategories.nameRequired'));
      return;
    }
    try {
      if (editingId) {
        const result = await update(editingId, { name: form.name, parentId: form.parentId || undefined });
        if (result.success) addToast('success', t('settings.productCategories.updated'));
        else addToast('error', result.error || t('settings.productCategories.updateError'));
      } else {
        const result = await create({ companyId: activeCompany.id, name: form.name, parentId: form.parentId || undefined });
        if (result.success) addToast('success', t('settings.productCategories.created'));
        else addToast('error', result.error || t('settings.productCategories.createError'));
      }
      setIsOpen(false);
      setForm({ name: '', parentId: '' });
      setEditingId(null);
    } catch {
      addToast('error', t('settings.productCategories.createError'));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const result = await remove(id);
      if (result.success) {
        addToast('success', t('settings.productCategories.deleted'));
      } else {
        addToast('error', result.error || t('settings.productCategories.deleteError'));
      }
      setShowDeleteConfirm(null);
    } catch {
      addToast('error', t('settings.productCategories.deleteError'));
    }
  };

  const openEdit = (node: CategoryNode) => {
    setForm({ name: node.name, parentId: node.parentId || '' });
    setEditingId(node.id);
    setIsOpen(true);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FolderTree size={28} className="text-primary-600 dark:text-primary-400" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{t('settings.productCategories.title')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">{t('settings.productCategories.subtitle')}</p>
          </div>
        </div>
        <Can action="create" module="settings">
          <Button variant="primary" leftIcon={<Plus size={16} />} onClick={() => { setForm({ name: '', parentId: '' }); setEditingId(null); setIsOpen(true); }}>{t('settings.productCategories.new')}</Button>
        </Can>
      </div>

      <Card>
        {isLoading ? (
          <div className="p-8 text-center text-slate-400">{t('settings.common.loading')}</div>
        ) : tree.length === 0 ? (
          <div className="p-8 text-center text-slate-400">{t('settings.productCategories.empty')}</div>
        ) : (
          <div className="space-y-1">
            {tree.map(node => (
              <TreeNode key={node.id} node={node} level={0} onEdit={openEdit} onDelete={(id) => setShowDeleteConfirm(id)} t={t} />
            ))}
          </div>
        )}
      </Card>

      <ConfirmDialog
        isOpen={!!showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(null)}
        onConfirm={() => showDeleteConfirm && handleDelete(showDeleteConfirm)}
        title={t('settings.productCategories.deleteTitle')}
        message={t('settings.productCategories.deleteMessage')}
        confirmText={t('settings.common.delete')}
        variant="danger"
      />

      {isOpen && (
        <Modal isOpen={isOpen} title={editingId ? t('settings.productCategories.editTitle') : t('settings.productCategories.newTitle')} onClose={() => setIsOpen(false)} size="md">
          <div className="space-y-4">
            <Input label={t('settings.productCategories.name')} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('settings.productCategories.parentCategory')}</label>
              <select
                value={form.parentId}
                onChange={e => setForm({ ...form, parentId: e.target.value })}
                className="w-full border border-slate-300 dark:border-slate-600 rounded-lg px-3 py-2 bg-white dark:bg-slate-900 text-sm"
              >
                <option value="">{t('settings.productCategories.noParent')}</option>
                {categories.filter(c => c.id !== editingId).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setIsOpen(false)}>{t('settings.common.cancel')}</Button>
              <Button onClick={handleSave} leftIcon={<CheckSquare size={16} />}>{t('settings.common.save')}</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default ProductCategoriesPage;
