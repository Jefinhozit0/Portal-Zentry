import { MODALIDADES, type Modalidade } from "@shared/notificacao";

export function TipoContratoSelect({ value, onChange, disabled = false, label = "Tipo de contrato" }: {
  value: Modalidade;
  onChange: (value: Modalidade) => void;
  disabled?: boolean;
  label?: string;
}) {
  return <label>{label}
    <select value={value} onChange={(event) => onChange(event.target.value as Modalidade)} disabled={disabled}>
      {MODALIDADES.map((option) => <option key={option} value={option}>Contrato de {option}</option>)}
    </select>
  </label>;
}
