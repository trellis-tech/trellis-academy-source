'use client'
import React from 'react'
import { FileArchive } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface ImportTypeSelectorProps {
  onSelectType: (type: 'learnhouse') => void
}

function ImportTypeSelector({ onSelectType }: ImportTypeSelectorProps) {
  const { t } = useTranslation()

  return (
    <div className="min-w-[400px] py-2">
      <div className="grid grid-cols-1 gap-4">
        <button
          onClick={() => onSelectType('learnhouse')}
          className="group flex flex-col items-center p-6 rounded-xl border-2 border-gray-200 bg-white hover:border-black hover:shadow-lg transition-all duration-200"
        >
          <div className="w-14 h-14 rounded-full bg-blue-50 flex items-center justify-center mb-4 group-hover:bg-blue-100 transition-colors">
            <FileArchive size={28} className="text-blue-600" />
          </div>
          <h3 className="font-semibold text-gray-900 mb-1">
            {t('courses.import.learnhouse_courses')}
          </h3>
          <p className="text-sm text-gray-500 text-center">
            {t('courses.import.learnhouse_description')}
          </p>
        </button>
      </div>
    </div>
  )
}

export default ImportTypeSelector
