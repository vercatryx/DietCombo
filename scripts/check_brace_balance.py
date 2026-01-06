
import re

file_path = '/Users/david/Vercatryx Projects/Triagnle Main/components/clients/ClientProfile.tsx'

with open(file_path, 'r') as f:
    lines = f.readlines()

start_line = 1913
end_line = 2280

content = "".join(lines[start_line-1:end_line])

print(f"Checking lines {start_line}-{end_line}")

# Let's just print the last few lines of the block to see what we grabbed
print("Last 5 lines checked:")
print("".join(lines[end_line-6:end_line]))

# And check specific brace count
open_braces = content.count('{')
close_braces = content.count('}')
print(f"{{: {open_braces}, }}: {close_braces}")

open_parens = content.count('(')
close_parens = content.count(')')
print(f"(: {open_parens}, ): {close_parens}")
