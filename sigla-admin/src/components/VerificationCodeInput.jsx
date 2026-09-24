import { useRef } from "react";

const CODE_LENGTH = 6;

const VerificationCodeInput = ({
  value,
  onChange,
  id = "verification-code",
  label = "Verification code",
  invalid = false,
  errorId,
}) => {
  const inputRefs = useRef([]);

  const focusInput = (index) => {
    inputRefs.current[Math.max(0, Math.min(index, CODE_LENGTH - 1))]?.focus();
  };

  const updateDigit = (index, rawValue) => {
    const incomingDigits = rawValue.replace(/\D/g, "");
    if (!incomingDigits) {
      onChange(value.map((digit, digitIndex) => (
        digitIndex === index ? "" : digit
      )));
      return;
    }

    const next = [...value];
    incomingDigits
      .slice(0, CODE_LENGTH - index)
      .split("")
      .forEach((digit, offset) => {
        next[index + offset] = digit;
      });
    onChange(next);
    focusInput(index + incomingDigits.length);
  };

  const handleKeyDown = (index, event) => {
    if (event.key === "Backspace") {
      event.preventDefault();
      if (value[index]) {
        onChange(value.map((digit, digitIndex) => (
          digitIndex === index ? "" : digit
        )));
      } else if (index > 0) {
        const previousIndex = index - 1;
        onChange(value.map((digit, digitIndex) => (
          digitIndex === previousIndex ? "" : digit
        )));
        focusInput(previousIndex);
      }
      return;
    }

    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusInput(index - 1);
    }
    if (event.key === "ArrowRight" && index < CODE_LENGTH - 1) {
      event.preventDefault();
      focusInput(index + 1);
    }
  };

  const handlePaste = (event) => {
    const digits = event.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, CODE_LENGTH);
    if (!digits) return;

    event.preventDefault();
    onChange(Array.from(
      { length: CODE_LENGTH },
      (_, index) => digits[index] || "",
    ));
    focusInput(digits.length);
  };

  return (
    <fieldset className="account-otp-fieldset">
      <legend className="account-modal-label">{label}</legend>
      <div className="account-otp-grid" onPaste={handlePaste}>
        {value.map((digit, index) => (
          <input
            key={index}
            id={index === 0 ? id : undefined}
            ref={(node) => {
              inputRefs.current[index] = node;
            }}
            type="text"
            value={digit}
            onChange={(event) => updateDigit(index, event.target.value)}
            onKeyDown={(event) => handleKeyDown(index, event)}
            onFocus={(event) => event.target.select()}
            inputMode="numeric"
            pattern="[0-9]"
            maxLength={index === 0 ? CODE_LENGTH : 1}
            autoComplete={index === 0 ? "one-time-code" : "off"}
            aria-invalid={invalid || undefined}
            aria-describedby={errorId}
            aria-label={`${label} digit ${index + 1}`}
            className="account-otp-cell"
          />
        ))}
      </div>
    </fieldset>
  );
};

export default VerificationCodeInput;
