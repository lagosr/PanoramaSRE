import React from 'react';
import { CustomSelect as UiKitCustomSelect } from '@lagosr/panorama-ui-kit';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

interface CustomSelectProps {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  options,
  onChange,
  placeholder = 'Select option...',
  className = '',
}) => {
  return (
    <UiKitCustomSelect
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
      options={options.map((opt) => ({
        value: opt.value,
        label: opt.label,
        subLabel: opt.description,
      }))}
    />
  );
};
