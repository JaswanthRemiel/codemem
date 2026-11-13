; JavaScript only: arrow functions and function expressions assigned to class fields.
(field_definition property: (_) @name
  value: [(arrow_function body: (_) @body) (function_expression body: (_) @body)]) @def.method

; inheritance
(class_heritage (identifier) @ref.extends)
