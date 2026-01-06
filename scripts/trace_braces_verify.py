
file_path = '/Users/david/Vercatryx Projects/Triagnle Main/components/clients/ClientProfile.tsx'

with open(file_path, 'r') as f:
    lines = f.readlines()

start_line = 1920
end_line = 2350

balance = 0 # Relative balance
for i in range(start_line-1, end_line):
    line = lines[i]
    for char in line:
        if char == '{':
            balance += 1
        elif char == '}':
            balance -= 1
    
    # print(f"Line {i+1}: Balance {balance} | {line.strip()}")
    if balance < 0:
        print(f"!!! DIpped below zero at line {i+1}")

print(f"Final Balance: {balance}")
