import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../services/supabase'
import { getFiscalYear, getFiscalMonth } from '../../services/api'
import { useAuthStore } from '../../store/authStore'
import toast from 'react-hot-toast'

const DEPARTMENTS = ['Client','Shipping','Supplier','Production','Logistics','Install','Ext. Sales','Int. Sales','NCW','Product Dev.','Engineering','VC','Project Mgnt','EOI','Vietnam','Planning']
const CATEGORIES  = ['Damage','Missing parts','Wrong item','Assembly issue','Finish defect','Packaging','Measurement','Other']
const BRANDS      = ['HIEX','HOME 2','INDEP','ResHall','SBG','STWD','Other']
const EDITOR_ROLES = ['admin','manager','cpm','service_desk']

const emptyLine = () => ({
  quality_issue: '', categories: '', department: '', line_item: '',
  foliot_id: '', plant: '', affected_qty: '', cost_approx: '', photos: [],
})

function StepBar({ step }) {
  const steps = ['Général', 'Lignes', 'Confirmer']
  return (
    <div style={s.stepBar}>
      {steps.map((label, i) => {
        const n = i + 1
        const done   = step > n
        const active = step === n
        return (
          <div key={n} style={s.stepItem}>
            <div style={{
              ...s.stepCircle,
              background: done ? '#1D9E75' : active ? '#185FA5' : '#E5E7EB',
              color: done || active ? '#fff' : '#9CA3AF',
            }}>
              {done ? '✓' : n}
            </div>
            <span style={{ ...s.stepLabel, color: active ? '#185FA5' : done ? '#1D9E75' : '#9CA3AF' }}>
              {label}
            </span>
            {i < steps.length - 1 && (
              <div style={{ ...s.stepLine, background: done ? '#1D9E75' : '#E5E7EB' }} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function Field({ label, required, children }) {
  return (
    <div style={s.fieldGroup}>
      <label style={s.label}>{label}{required && <span style={{ color:'#EF4444' }}> *</span>}</label>
      {children}
    </div>
  )
}

function MInput({ value, onChange, placeholder, type = 'text', ...props }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={s.input}
      {...props}
    />
  )
}

function MSelect({ value, onChange, options, placeholder = '—' }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={s.input}>
      <option value="">{placeholder}</option>
      {options.map(o => (
        <option key={typeof o === 'string' ? o : o.value} value={typeof o === 'string' ? o : o.value}>
          {typeof o === 'string' ? o : o.label}
        </option>
      ))}
    </select>
  )
}

function LineCard({ line, idx, onChange, onDelete, plants }) {
  const fileRef = useRef(null)

  const handleFiles = async (files) => {
    const newPhotos = await Promise.all(Array.from(files).map(async f => ({
      file: f,
      buffer: await f.arrayBuffer(),
      type: f.type || 'image/jpeg',
      name: f.name,
      preview: URL.createObjectURL(f),
      dataUrl: null,
      annotated: false,
    })))
    onChange(idx, '_addPhotos', newPhotos)
  }

  return (
    <div style={s.lineCard}>
      <div style={s.lineCardHeader}>
        <span style={s.lineCardTitle}>Ligne {idx + 1}</span>
        {idx > 0 && (
          <button onClick={() => onDelete(idx)} style={s.deleteBtn}>✕</button>
        )}
      </div>

      <Field label="Description du problème" required>
        <textarea
          value={line.quality_issue}
          onChange={e => onChange(idx, 'quality_issue', e.target.value)}
          placeholder="Décrivez le problème..."
          style={{ ...s.input, minHeight: 80, resize: 'vertical' }}
        />
      </Field>

      <div style={s.row2}>
        <Field label="Catégorie">
          <MSelect value={line.categories} onChange={v => onChange(idx,'categories',v)} options={CATEGORIES} />
        </Field>
        <Field label="Département">
          <MSelect value={line.department} onChange={v => onChange(idx,'department',v)} options={DEPARTMENTS} />
        </Field>
      </div>

      <div style={s.row2}>
        <Field label="Line Item">
          <MInput value={line.line_item} onChange={v => onChange(idx,'line_item',v)} placeholder="Line item..." />
        </Field>
        <Field label="Foliot ID">
          <MInput value={line.foliot_id} onChange={v => onChange(idx,'foliot_id',v)} placeholder="Foliot ID..." />
        </Field>
      </div>

      <div style={s.row2}>
        <Field label="Usine">
          <MSelect
            value={line.plant}
            onChange={v => onChange(idx,'plant',v)}
            options={(plants||[]).map(p => ({ value: p.name, label: p.name }))}
          />
        </Field>
        <Field label="Qté affectée">
          <MInput value={line.affected_qty} onChange={v => onChange(idx,'affected_qty',v)} type="number" placeholder="0" />
        </Field>
      </div>

      <Field label="Coût approx. ($)">
        <MInput value={line.cost_approx} onChange={v => onChange(idx,'cost_approx',v)} placeholder="0.00" />
      </Field>

      <div style={s.photosSection}>
        <span style={s.photosLabel}>Photos</span>
        <div style={s.photoGrid}>
          {(line.photos||[]).map((p, pi) => (
            <div key={pi} style={s.photoThumb}>
              <img sr
