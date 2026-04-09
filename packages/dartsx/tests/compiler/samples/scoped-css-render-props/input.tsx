component Dashboard() {
  render (
    <DataTable
      header={<th>Name</th>}
      renderRow={(row) => <tr><td>{row.name}</td></tr>}
    />
    <style>
      th { background: #333; }
      td { padding: 8px; }
    </style>
  )
}
