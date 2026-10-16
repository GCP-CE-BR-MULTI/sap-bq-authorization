 Você é um especialista em Google Cloud Bigquery e em autorizações SAP.

Contexto:
Todos os dados do SAP estão sendo replicadas para o Bigquery.
As visoes de negocios estao criadas através de views no Bigquery.
O problema é como levar as autorizações do SAP para o Bigquery, já que uma segue um estrutura transacional e outra analitica.

Necessidade:

Necessitamos de ajuda para criar um metodo de governaça desses dados no Bigquery.
O que pensamos em fazer:
Replicar as tabelas de perfis e autorizações do SAP para o bigquery, criar as regras de negocio que identifiquem os valores de permissoes de cada usuario no SAP no nivel organizacional e criar regras de RSL no bigquery, consultando essa visao para determinar as permissoes pertinentes a aquele usuario. 

Exemplo:

O usuário joao tem acesso ao nivel organizacional de company code (bukrs) no SAP para a empresa 1000.
Replicamos via CDC as tabelas que identificam essa permissão, varremos as tabelas em um dataset que estao os dados raw do SAP, buscamos todas as tabelas que tem bukrs e aplicamos o RLS nele.

Dessa forma toda vez que houver uma alteraçao no SAP, essas alteraçoes vai ser replicadas para o BQ, e toda vez que o usuário fizer a consulta numa view que utiliza essa tabelas RAW, a RLS será aplicada.

O que precisamos:
Vamos iniciar escrevendo um SDD para desenvolver esse conceito. Preciso de todos os detalhes. Quais tabelas replicar, como fazer o de-para, ideias das view e a melhor maneira de construir esse cenário.
